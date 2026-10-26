#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Command, CommanderError, InvalidArgumentError } from 'commander'
import { checkCommand } from './commands/check.js'
import type { AppDeps } from './commands/pipeline.js'
import { prCommand } from './commands/pr.js'
import { type StartOptions, startCommand } from './commands/start.js'
import { MuellimError } from './errors.js'
import { type Git, openGit } from './git/git.js'
import { createGh, type Gh } from './github/gh.js'
import { createAiSdkClient } from './providers/ai-sdk.js'
import { createModel, readConfig } from './providers/config.js'
import { createTranscript, type Transcript } from './session/transcript.js'
import { en } from './strings/en.js'
import { createTerminalAsker } from './ui/terminal.js'

/** Kept equal to package.json's version by test/cli.test.ts. */
export const VERSION = '0.1.0'

export interface CliEnv {
  cwd: string
  out(text: string): void
  err(text: string): void
  makeDeps(git: Git): AppDeps & { gh: Gh }
  /** Registers a Ctrl-C handler and returns its remover. Defaults to the process SIGINT signal. */
  onInterrupt?(handler: () => void): () => void
}

function parsePullRequest(value: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError(en.cli.badNumber)
  return n
}

function onProcessInterrupt(handler: () => void): () => void {
  process.once('SIGINT', handler)
  return () => {
    process.off('SIGINT', handler)
  }
}

export function realDeps(git: Git, env: NodeJS.ProcessEnv): AppDeps & { gh: Gh } {
  return {
    git,
    asker: createTerminalAsker(),
    transcript: createTranscript(git.root),
    makeLlm: () => createAiSdkClient(createModel(readConfig(env))),
    now: () => new Date(),
    gh: createGh(git.root),
  }
}

/** Runs one command and returns the exit code. Expected failures print one line from en.errors. */
export async function main(argv: string[], cli: CliEnv): Promise<number> {
  // `begun` and `closed` keep the abandoned line to one, whichever of Inquirer's path or the
  // Ctrl-C handler gets there first.
  let begun = false
  let closed = false
  let guard: Transcript | undefined
  const guarded = (inner: Transcript): Transcript => {
    guard = {
      begin: async (kind) => {
        begun = true
        try {
          await inner.begin(kind)
        } catch (error) {
          begun = false
          throw error
        }
      },
      answerKeys: (questions) => inner.answerKeys(questions),
      result: (index, result) => inner.result(index, result),
      passed: async (score, notQuizzedChunks) => {
        closed = true
        try {
          await inner.passed(score, notQuizzedChunks)
        } catch (error) {
          closed = false
          throw error
        }
      },
      abandoned: async () => {
        if (closed) return
        closed = true
        await inner.abandoned()
      },
    }
    return guard
  }

  const deps = async () => {
    const app = cli.makeDeps(await openGit(cli.cwd))
    return { ...app, transcript: guarded(app.transcript) }
  }
  const program = new Command()
    .name('muellim')
    .description(en.cli.description)
    .version(VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (s) => cli.out(s.trimEnd()),
      writeErr: (s) => cli.err(s.trimEnd()),
    })

  program
    .command('start')
    .description(en.cli.start)
    .option('--goal <text>', en.cli.goal)
    .option('--focus <areas>', en.cli.focus)
    .action(async (options: StartOptions) => {
      await startCommand(await deps(), options)
    })
  program
    .command('check')
    .description(en.cli.check)
    .action(async () => {
      await checkCommand(await deps())
    })
  program
    .command('pr')
    .description(en.cli.pr)
    .argument('<number>', en.cli.prNumber, parsePullRequest)
    .action(async (pullRequest: number) => {
      await prCommand(await deps(), pullRequest)
    })

  let interrupt: () => void = () => {}
  const interrupted = new Promise<'interrupted'>((resolve) => {
    interrupt = () => resolve('interrupted')
  })
  const removeInterrupt = (cli.onInterrupt ?? onProcessInterrupt)(() => interrupt())
  try {
    const outcome = await Promise.race([
      program.parseAsync(argv, { from: 'user' }).then(() => 'done' as const),
      interrupted,
    ])
    if (outcome === 'interrupted') {
      if (guard && begun && !closed) await guard.abandoned().catch(() => {})
      cli.err(en.errors.aborted)
      return 1
    }
    return 0
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode
    if (error instanceof MuellimError) {
      cli.err(en.errors[error.code])
      return 1
    }
    cli.err(error instanceof Error ? error.message : String(error))
    return 1
  } finally {
    removeInterrupt()
  }
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2), {
    cwd: process.cwd(),
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    makeDeps: (git) => realDeps(git, process.env),
  }).then((code) => {
    process.exit(code)
  })
}

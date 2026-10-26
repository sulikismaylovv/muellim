import { readFileSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type CliEnv, main, VERSION } from '../src/cli.js'
import { MuellimError } from '../src/errors.js'
import type { LlmClient, LlmRequest } from '../src/providers/llm.js'
import { loadSession } from '../src/session/store.js'
import type { Transcript } from '../src/session/transcript.js'
import { createTranscript } from '../src/session/transcript.js'
import { en } from '../src/strings/en.js'
import { FakeLlm, ScriptedAsker } from './helpers/fakes.js'
import { tempRepo } from './helpers/repo.js'

const onePlan = {
  questions: [
    {
      kind: 'choice',
      topic: 'refresh token lifetime',
      prompt: 'How long does a refresh token live?',
      choices: ['1 hour', '7 days'],
      answerKey: '7 days',
      rubric: [],
    },
  ],
}

function cliEnv(cwd: string, makeLlm: () => LlmClient = () => new FakeLlm({})) {
  const out: string[] = []
  const err: string[] = []
  const env: CliEnv = {
    cwd,
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    makeDeps: (git) => ({
      git,
      asker: new ScriptedAsker([]),
      transcript: createTranscript(git.root),
      makeLlm,
      now: () => new Date('2026-10-26T12:00:00.000Z'),
      gh: { prDiff: async () => '', prHead: async () => 'abc' },
    }),
  }
  return { env, out, err }
}

describe('main', () => {
  it('prints the version from package.json', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const { env, out } = cliEnv(process.cwd())
    expect(await main(['--version'], env)).toBe(0)
    expect(out).toEqual([pkg.version])
    expect(VERSION).toBe(pkg.version)
  })

  it('prints one line from en.errors and exits 1 for an expected failure', async () => {
    const repo = await tempRepo()
    const { env, err } = cliEnv(repo.dir)
    expect(await main(['check'], env)).toBe(1)
    expect(err).toEqual([en.errors['no-session']])
  })

  it('reports not-git outside a repository', async () => {
    const { env, err } = cliEnv(await mkdtemp(join(tmpdir(), 'muellim-cli-')))
    expect(await main(['check'], env)).toBe(1)
    expect(err).toEqual([en.errors['not-git']])
  })

  it('rejects a pull request number that is not a positive whole number', async () => {
    const repo = await tempRepo()
    const { env, err } = cliEnv(repo.dir)
    expect(await main(['pr', 'abc'], env)).toBe(1)
    expect(err.join('\n')).toContain(en.cli.badNumber)
  })

  it('starts a session from options without asking anything', async () => {
    const repo = await tempRepo()
    const { env } = cliEnv(repo.dir)
    expect(await main(['start', '--goal', 'fix login', '--focus', 'auth'], env)).toBe(0)
  })

  it('needs no AI key when there is nothing to check', async () => {
    const repo = await tempRepo()
    const missingKey = () => {
      throw new MuellimError('missing-key')
    }
    const { env } = cliEnv(repo.dir, missingKey)
    expect(await main(['start', '--goal', 'x', '--focus', ''], env)).toBe(0)
    expect(await main(['check'], env)).toBe(0)
  })

  it('reports a missing key once there is work to quiz', async () => {
    const repo = await tempRepo()
    const missingKey = () => {
      throw new MuellimError('missing-key')
    }
    const { env, err } = cliEnv(repo.dir, missingKey)
    await main(['start', '--goal', 'x', '--focus', ''], env)
    await repo.write('src/a.ts', 'export const a = 1\n')
    expect(await main(['check'], env)).toBe(1)
    expect(err).toEqual([en.errors['missing-key']])
  })

  it('turns Ctrl-C during an AI call into one abandoned line, the aborted message and exit 1', async () => {
    const repo = await tempRepo()
    let release: (error: Error) => void = () => {}
    let called: () => void = () => {}
    const generateCalled = new Promise<void>((resolve) => {
      called = resolve
    })
    const pending: LlmClient = {
      generate: <T>(_request: LlmRequest<T>) =>
        new Promise<T>((_resolve, reject) => {
          release = reject
          called()
        }),
      usage: () => ({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    }
    const { env, err } = cliEnv(repo.dir, () => pending)
    let interrupt: () => void = () => {}
    let removed = 0
    env.onInterrupt = (handler) => {
      interrupt = handler
      return () => {
        removed += 1
      }
    }
    await main(['start', '--goal', 'x', '--focus', ''], env)
    await repo.write('src/a.ts', 'export const a = 1\n')
    removed = 0
    const running = main(['check'], env)
    await generateCalled
    interrupt()
    expect(await running).toBe(1)
    expect(err).toEqual([en.errors.aborted])
    expect(removed).toBe(1)
    const abandonedLines = async () =>
      (await readFile(join(repo.dir, '.muellim', 'transcript.md'), 'utf8')).split(
        en.transcript.abandoned,
      ).length - 1
    // The interrupt branch wrote it, before the AI call settled.
    expect(await abandonedLines()).toBe(1)
    // The command then fails into the engine's own abandoned call; it must not write a second line.
    release(new Error('request cancelled'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await abandonedLines()).toBe(1)
  })

  it('leaves one abandoned line when Ctrl-C arrives after the quiz already wrote it', async () => {
    const repo = await tempRepo()
    const { env, err } = cliEnv(repo.dir, () => new FakeLlm({ plan: [onePlan] }))
    let interrupt: () => void = () => {}
    env.onInterrupt = (handler) => {
      interrupt = handler
      return () => {}
    }
    await main(['start', '--goal', 'x', '--focus', ''], env)
    await repo.write('src/a.ts', 'export const a = 1\n')
    const makeDeps = env.makeDeps
    env.makeDeps = (git) => {
      const app = makeDeps(git)
      const inner: Transcript = app.transcript
      return {
        ...app,
        asker: new ScriptedAsker([new MuellimError('aborted')]),
        transcript: {
          ...inner,
          abandoned: async () => {
            await inner.abandoned()
            interrupt()
          },
        },
      }
    }
    expect(await main(['check'], env)).toBe(1)
    expect(err).toEqual([en.errors.aborted])
    const transcript = await readFile(join(repo.dir, '.muellim', 'transcript.md'), 'utf8')
    expect(transcript.split(en.transcript.abandoned).length - 1).toBe(1)
  })

  it('writes no passed line and marks nothing passed when the AI reply lands after Ctrl-C', async () => {
    const repo = await tempRepo()
    const fake = new FakeLlm({ plan: [onePlan] })
    let release: () => void = () => {}
    let called: () => void = () => {}
    const generateCalled = new Promise<void>((resolve) => {
      called = resolve
    })
    const late: LlmClient = {
      generate: async <T>(request: LlmRequest<T>) => {
        called()
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return fake.generate(request)
      },
      usage: () => fake.usage(),
    }
    const { env, err } = cliEnv(repo.dir, () => late)
    let interrupt: () => void = () => {}
    env.onInterrupt = (handler) => {
      interrupt = handler
      return () => {}
    }
    const makeDeps = env.makeDeps
    env.makeDeps = (git) => {
      const app = makeDeps(git)
      return { ...app, asker: new ScriptedAsker(['7 days']) }
    }
    await main(['start', '--goal', 'x', '--focus', ''], env)
    await repo.write('src/a.ts', 'export const a = 1\n')
    const before = (await loadSession(repo.dir))?.passed
    const running = main(['check'], env)
    await generateCalled
    interrupt()
    expect(await running).toBe(1)
    expect(err).toEqual([en.errors.aborted])
    // The AI reply lands after main returned; the command carries on in the background.
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const transcript = await readFile(join(repo.dir, '.muellim', 'transcript.md'), 'utf8')
    expect(transcript).not.toContain('**Status:** passed')
    expect(transcript.split(en.transcript.abandoned).length - 1).toBe(1)
    expect((await loadSession(repo.dir))?.passed).toEqual(before)
  })
})

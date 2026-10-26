import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkCommand } from '../../src/commands/check.js'
import type { AppDeps } from '../../src/commands/pipeline.js'
import { startCommand } from '../../src/commands/start.js'
import { openGit } from '../../src/git/git.js'
import { loadSession } from '../../src/session/store.js'
import { createTranscript } from '../../src/session/transcript.js'
import { FakeLlm, ScriptedAsker } from '../helpers/fakes.js'
import { tempRepo } from '../helpers/repo.js'

const now = () => new Date('2026-10-26T12:00:00.000Z')

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

async function deps(dir: string, answers: string[], llm: FakeLlm) {
  const git = await openGit(dir)
  const asker = new ScriptedAsker(answers)
  const app: AppDeps = {
    git,
    asker,
    transcript: createTranscript(dir, now),
    makeLlm: () => llm,
    now,
  }
  return { app, asker }
}

describe('start', () => {
  it('asks for the brief and saves the session at the base commit', async () => {
    const repo = await tempRepo()
    const { app, asker } = await deps(
      repo.dir,
      ['add refresh tokens', 'auth, tokens '],
      new FakeLlm({}),
    )
    const session = await startCommand(app, {})
    expect(session.brief).toEqual({ goal: 'add refresh tokens', focus: ['auth', 'tokens'] })
    expect((await loadSession(repo.dir))?.baseCommit).toBe(session.baseCommit)
    expect(asker.shown.at(-1)).toContain('Session started at')
  })

  it('takes the brief from options without asking', async () => {
    const repo = await tempRepo()
    const { app } = await deps(repo.dir, [], new FakeLlm({}))
    const session = await startCommand(app, { goal: 'fix login', focus: '' })
    expect(session.brief).toEqual({ goal: 'fix login', focus: [] })
  })
})

describe('check', () => {
  it('fails with no-session before start', async () => {
    const repo = await tempRepo()
    const { app } = await deps(repo.dir, [], new FakeLlm({}))
    await expect(checkCommand(app)).rejects.toMatchObject({ code: 'no-session' })
  })

  it('quizzes new work, marks it passed, then has nothing left to check', async () => {
    const repo = await tempRepo()
    const first = await deps(repo.dir, [], new FakeLlm({}))
    await startCommand(first.app, { goal: 'refresh tokens', focus: 'auth' })
    await repo.write('src/auth.ts', 'export const REFRESH_TTL_DAYS = 7\n')

    const quiz = await deps(repo.dir, ['7 days'], new FakeLlm({ plan: [onePlan] }))
    const result = await checkCommand(quiz.app)
    expect(result.status).toBe('passed')
    expect(quiz.asker.shown).toContain(
      'Run complete: 1 right first time, 0 right on retry, 0 taught but not yet understood.',
    )
    expect((await loadSession(repo.dir))?.passed.length).toBeGreaterThan(0)

    const again = await deps(repo.dir, [], new FakeLlm({}))
    expect((await checkCommand(again.app)).status).toBe('nothing-to-check')
    expect(again.asker.shown).toContain('Nothing new to check since your last pass.')
  })

  it('never sends a secret file, even when it is part of the change', async () => {
    const repo = await tempRepo()
    const first = await deps(repo.dir, [], new FakeLlm({}))
    await startCommand(first.app, { goal: 'x', focus: '' })
    await repo.write('.env', 'API_KEY=super-secret\n')
    await repo.write('src/a.ts', 'export const a = 1\n')
    const llm = new FakeLlm({ plan: [onePlan] })
    await checkCommand((await deps(repo.dir, ['7 days'], llm)).app)
    expect(llm.requests[0]?.prompt).toContain('src/a.ts')
    expect(llm.requests[0]?.prompt).not.toContain('super-secret')
  })

  it('keeps the partial transcript and marks nothing passed when the user stops', async () => {
    const repo = await tempRepo()
    const first = await deps(repo.dir, [], new FakeLlm({}))
    await startCommand(first.app, { goal: 'x', focus: '' })
    await repo.write('src/a.ts', 'export const a = 1\n')
    const git = await openGit(repo.dir)
    const app: AppDeps = {
      git,
      asker: {
        askText: async () => '',
        askChoice: async () => {
          throw Object.assign(new Error('stop'), { code: 'aborted' })
        },
        show: () => {},
      },
      transcript: createTranscript(repo.dir, now),
      makeLlm: () => new FakeLlm({ plan: [onePlan] }),
      now,
    }
    await expect(checkCommand(app)).rejects.toThrow('stop')
    expect((await loadSession(repo.dir))?.passed).toEqual([])
    const transcript = await readFile(join(repo.dir, '.muellim/transcript.md'), 'utf8')
    expect(transcript).toContain('**Status:** abandoned.')
  })
})

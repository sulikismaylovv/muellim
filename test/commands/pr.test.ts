import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AppDeps } from '../../src/commands/pipeline.js'
import { prCommand } from '../../src/commands/pr.js'
import { lineKey } from '../../src/diff/chunks.js'
import { openGit } from '../../src/git/git.js'
import type { Gh } from '../../src/github/gh.js'
import { saveSession } from '../../src/session/store.js'
import { createTranscript } from '../../src/session/transcript.js'
import { FakeLlm, ScriptedAsker } from '../helpers/fakes.js'
import { tempRepo } from '../helpers/repo.js'

const now = () => new Date('2026-10-26T12:00:00.000Z')

const PR_DIFF = [
  'diff --git a/src/auth.ts b/src/auth.ts',
  'index 1111111..2222222 100644',
  '--- a/src/auth.ts',
  '+++ b/src/auth.ts',
  '@@ -1,1 +1,2 @@',
  ' export const ACCESS_TTL_HOURS = 1',
  '+export const REFRESH_TTL_DAYS = 7',
  '',
].join('\n')

const plan = {
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

const gh: Gh = { prDiff: async () => PR_DIFF, prHead: async () => 'def5678' }

async function deps(dir: string, answers: string[], llm: FakeLlm) {
  const asker = new ScriptedAsker(answers)
  const app: AppDeps & { gh: Gh } = {
    git: await openGit(dir),
    asker,
    transcript: createTranscript(dir, now),
    makeLlm: () => llm,
    now,
    gh,
  }
  return { app, asker }
}

describe('pr', () => {
  it('quizzes the pull request and writes the pass for spec 2', async () => {
    const repo = await tempRepo()
    const { app, asker } = await deps(repo.dir, ['7 days'], new FakeLlm({ plan: [plan] }))
    const pass = await prCommand(app, 42)
    expect(pass).toEqual({
      pullRequest: 42,
      headSha: 'def5678',
      score: { firstTry: 1, onRetry: 0, taught: 0, total: 1 },
      topics: ['refresh token lifetime'],
      notQuizzedChunks: 0,
      createdAt: '2026-10-26T12:00:00.000Z',
    })
    const saved = JSON.parse(await readFile(join(repo.dir, '.muellim/pr-42.json'), 'utf8'))
    expect(saved.headSha).toBe('def5678')
    expect(asker.shown.at(-1)).toBe('Pass for #42 saved to .muellim/pr-42.json.')
  })

  it('counts a pull request that earlier checks fully covered as a pass, with no AI call', async () => {
    const repo = await tempRepo()
    await saveSession(repo.dir, {
      version: 1,
      startedAt: '2026-10-26T10:00:00.000Z',
      baseCommit: 'abc',
      brief: { goal: 'x', focus: [] },
      passed: [lineKey('src/auth.ts', '+export const REFRESH_TTL_DAYS = 7')],
    })
    const llm = new FakeLlm({})
    const { app, asker } = await deps(repo.dir, [], llm)
    const pass = await prCommand(app, 7)
    expect(pass.score.total).toBe(0)
    expect(llm.requests).toHaveLength(0)
    expect(asker.shown).toContain('Nothing new to check since your last pass.')
  })

  it('surfaces gh errors unchanged', async () => {
    const repo = await tempRepo()
    const { app } = await deps(repo.dir, [], new FakeLlm({}))
    const failing: Gh = {
      prDiff: async () => {
        throw Object.assign(new Error('gh-auth'), { code: 'gh-auth' })
      },
      prHead: async () => 'x',
    }
    await expect(prCommand({ ...app, gh: failing }, 1)).rejects.toMatchObject({ code: 'gh-auth' })
  })
})

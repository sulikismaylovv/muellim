import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AppDeps } from '../../src/commands/pipeline.js'
import { prCommand } from '../../src/commands/pr.js'
import { lineKey } from '../../src/diff/chunks.js'
import { openGit } from '../../src/git/git.js'
import type { Gh } from '../../src/github/gh.js'
import { readMarker } from '../../src/github/marker.js'
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

const gh: Gh = {
  prDiff: async () => PR_DIFF,
  prHead: async () => 'def5678',
  prComment: async () => {},
}

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
    expect(asker.shown).toContain('Pass for #42 saved to .muellim/pr-42.json.')
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

  it('posts the pass as a comment for the pull request head', async () => {
    const repo = await tempRepo()
    const { app } = await deps(repo.dir, ['7 days'], new FakeLlm({ plan: [plan] }))
    const comments: Array<[number, string]> = []
    const recording: Gh = {
      ...gh,
      prComment: async (n, body) => {
        comments.push([n, body])
      },
    }
    await prCommand({ ...app, gh: recording }, 42)
    expect(comments).toHaveLength(1)
    expect(comments[0]?.[0]).toBe(42)
    expect(readMarker(comments[0]?.[1] ?? '')?.head).toBe('def5678')
  })

  it('keeps the saved pass when the comment cannot be posted', async () => {
    const repo = await tempRepo()
    const { app } = await deps(repo.dir, ['7 days'], new FakeLlm({ plan: [plan] }))
    const failing: Gh = {
      ...gh,
      prComment: async () => {
        throw new Error('network')
      },
    }
    await expect(prCommand({ ...app, gh: failing }, 42)).rejects.toMatchObject({
      code: 'comment-failed',
    })
    const saved = JSON.parse(await readFile(join(repo.dir, '.muellim/pr-42.json'), 'utf8'))
    expect(saved.headSha).toBe('def5678')
  })

  it('posts nothing when the quiz fails', async () => {
    const repo = await tempRepo()
    const { app } = await deps(repo.dir, [], new FakeLlm({}))
    const comments: string[] = []
    const recording: Gh = {
      ...gh,
      prComment: async (_n, body) => {
        comments.push(body)
      },
    }
    await expect(prCommand({ ...app, gh: recording }, 42)).rejects.toThrow()
    expect(comments).toEqual([])
  })

  it.each([
    ['with a session', true],
    ['without a session', false],
  ])('posts the saved pass on a second run, %s, with no new quiz', async (_name, withSession) => {
    const repo = await tempRepo()
    if (withSession) {
      await saveSession(repo.dir, {
        version: 1,
        startedAt: '2026-10-26T10:00:00.000Z',
        baseCommit: 'abc',
        brief: { goal: 'x', focus: [] },
        passed: [],
      })
    }
    const first = await deps(repo.dir, ['7 days'], new FakeLlm({ plan: [plan] }))
    const failing: Gh = {
      ...gh,
      prComment: async () => {
        throw new Error('network')
      },
    }
    await expect(prCommand({ ...first.app, gh: failing }, 42)).rejects.toMatchObject({
      code: 'comment-failed',
    })
    const savedAfterFailure = await readFile(join(repo.dir, '.muellim/pr-42.json'), 'utf8')

    const llm = new FakeLlm({})
    const second = await deps(repo.dir, [], llm)
    const comments: string[] = []
    const recording: Gh = {
      ...gh,
      prComment: async (_n, body) => {
        comments.push(body)
      },
    }
    const later = () => new Date('2026-10-27T12:00:00.000Z')
    const pass = await prCommand({ ...second.app, gh: recording, now: later }, 42)

    const score = { firstTry: 1, onRetry: 0, taught: 0, total: 1 }
    expect(llm.requests).toHaveLength(0)
    expect(pass.score).toEqual(score)
    expect(await readFile(join(repo.dir, '.muellim/pr-42.json'), 'utf8')).toBe(savedAfterFailure)
    expect(comments).toHaveLength(1)
    expect(readMarker(comments[0] ?? '')).toEqual({ head: 'def5678', score })
    expect(second.asker.shown).toContain('Posted the pass on pull request #42.')
  })

  it('runs a new quiz when the saved pass is for an older commit', async () => {
    const repo = await tempRepo()
    const first = await deps(repo.dir, ['7 days'], new FakeLlm({ plan: [plan] }))
    await prCommand(first.app, 42)

    const llm = new FakeLlm({ plan: [plan] })
    const second = await deps(repo.dir, ['7 days'], llm)
    const moved: Gh = { ...gh, prHead: async () => 'abc9999' }
    const pass = await prCommand({ ...second.app, gh: moved }, 42)

    expect(llm.requests.length).toBeGreaterThan(0)
    expect(pass.headSha).toBe('abc9999')
    const saved = JSON.parse(await readFile(join(repo.dir, '.muellim/pr-42.json'), 'utf8'))
    expect(saved.headSha).toBe('abc9999')
  })

  it('surfaces gh errors unchanged', async () => {
    const repo = await tempRepo()
    const { app } = await deps(repo.dir, [], new FakeLlm({}))
    const failing: Gh = {
      prDiff: async () => {
        throw Object.assign(new Error('gh-auth'), { code: 'gh-auth' })
      },
      prHead: async () => 'x',
      prComment: async () => {},
    }
    await expect(prCommand({ ...app, gh: failing }, 1)).rejects.toMatchObject({ code: 'gh-auth' })
  })
})

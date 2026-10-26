import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTranscript } from '../../src/session/transcript.js'
import type { Chunk, Question } from '../../src/types.js'

const question: Question = {
  id: 'q1',
  kind: 'choice',
  topic: 'token expiry',
  prompt: 'How long does a refresh token live?',
  choices: ['1 hour', '7 days', '30 days'],
  answerKey: '7 days',
  rubric: [],
}

const chunk = (file: string, header: string): Chunk => ({
  file,
  header,
  lines: ['+x'],
  added: 1,
  removed: 0,
  lineKeys: [`${file}-1`],
})

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'muellim-t-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('transcript', () => {
  it('writes answer keys before results, then the status', async () => {
    const root = await tempRoot()
    const transcript = createTranscript(root, () => new Date('2026-10-26T12:00:00.000Z'))
    await transcript.begin('check')
    await transcript.answerKeys([question])
    await transcript.result(1, {
      question,
      firstAnswer: '1 hour',
      firstGrade: { correct: false, feedback: 'That is the access token.' },
      lesson: 'Refresh tokens live 7 days; access tokens 1 hour.',
      retryAnswer: '7 days',
      retryGrade: { correct: true, feedback: 'Right.' },
      outcome: 'correct-on-retry',
    })
    await transcript.passed({ firstTry: 0, onRetry: 1, taught: 0, total: 1 }, [
      chunk('src/b.ts', '@@ -10,6 +10,8 @@ export function b() {'),
      chunk('src/c.ts', '@@ -0,0 +1 @@'),
    ])
    const text = await readFile(join(root, '.muellim/transcript.md'), 'utf8')
    expect(text).toContain('## check run, 2026-10-26T12:00:00.000Z')
    expect(text.indexOf('- Expected: 7 days')).toBeLessThan(text.indexOf('- First answer: 1 hour'))
    expect(text).toContain('- Choices: 1 hour | 7 days | 30 days')
    expect(text).toContain('- Outcome: correct on retry')
    expect(text).toContain('**Status:** passed. 0 right first time, 1 right on retry')
    expect(text).toContain(
      [
        '2 chunks over the question limit were not quizzed:',
        '- src/b.ts @@ -10,6 +10,8 @@ export function b() {',
        '- src/c.ts @@ -0,0 +1 @@',
      ].join('\n'),
    )
  })

  it('writes no not-quizzed list when every chunk was quizzed', async () => {
    const root = await tempRoot()
    const transcript = createTranscript(root)
    await transcript.passed({ firstTry: 1, onRetry: 0, taught: 0, total: 1 }, [])
    const text = await readFile(join(root, '.muellim/transcript.md'), 'utf8')
    expect(text).not.toContain('not quizzed')
  })

  it('appends runs and marks an abandoned one', async () => {
    const root = await tempRoot()
    const transcript = createTranscript(root)
    await transcript.begin('check')
    await transcript.abandoned()
    await transcript.begin('pr')
    const text = await readFile(join(root, '.muellim/transcript.md'), 'utf8')
    expect(text).toContain('**Status:** abandoned.')
    expect(text.match(/^## /gm)).toHaveLength(2)
  })
})

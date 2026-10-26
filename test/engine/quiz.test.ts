import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runQuiz } from '../../src/engine/quiz.js'
import { MuellimError } from '../../src/errors.js'
import type { Brief, RankedChunk } from '../../src/types.js'
import { FakeLlm, noLookups, recordingTranscript, ScriptedAsker } from '../helpers/fakes.js'

const plan: unknown = JSON.parse(
  readFileSync(new URL('../fixtures/llm/refresh-plan.json', import.meta.url), 'utf8'),
)
const brief: Brief = { goal: 'refresh tokens', focus: ['auth'] }

const chunk = (file: string, size = 3): RankedChunk => ({
  file,
  header: '@@ -1 +1 @@',
  lines: Array.from({ length: size }, (_, i) => `+line ${i}`),
  added: size,
  removed: 0,
  lineKeys: [`${file}-1`, `${file}-2`],
  score: 1,
  briefMatch: false,
})

function setup(answers: Array<string | Error>, llm: FakeLlm) {
  const log: string[] = []
  const asker = new ScriptedAsker(answers, log)
  return {
    log,
    asker,
    deps: { llm, asker, transcript: recordingTranscript(log), lookups: noLookups },
  }
}

describe('runQuiz', () => {
  it('writes the answer keys before the first question is asked', async () => {
    const llm = new FakeLlm({ plan: [plan], grade: [{ correct: true, feedback: 'Yes.' }] })
    const { log, deps } = setup(['It refreshes once, then stops.', '7 days'], llm)
    const result = await runQuiz('check', [chunk('src/auth.ts')], brief, deps)
    expect(log).toEqual([
      'begin:check',
      'keys:2',
      'ask',
      'result:1:correct',
      'ask',
      'result:2:correct',
      'passed:2:0',
    ])
    expect(result.status).toBe('passed')
    expect(result.score).toEqual({ firstTry: 2, onRetry: 0, taught: 0, total: 2 })
    expect(result.quizzed).toEqual(['src/auth.ts-1', 'src/auth.ts-2'])
  })

  it('grades choice answers locally and open answers through the AI', async () => {
    const llm = new FakeLlm({ plan: [plan], grade: [{ correct: true, feedback: '' }] })
    const { deps } = setup(['answer', '7 days'], llm)
    await runQuiz('check', [chunk('src/auth.ts')], brief, deps)
    expect(llm.requests.map((r) => r.purpose)).toEqual(['plan', 'grade'])
    expect(llm.requests[0]?.lookups).toBe(noLookups)
  })

  it('teaches a miss and records a right retry as correct on retry', async () => {
    const llm = new FakeLlm({
      plan: [plan],
      grade: [{ correct: true, feedback: '' }],
      lesson: [{ lesson: 'The TTL constant is 7 days.' }],
    })
    const { asker, deps } = setup(['answer', '1 hour', '7 days'], llm)
    const result = await runQuiz('check', [chunk('src/auth.ts')], brief, deps)
    expect(result.results[1]?.outcome).toBe('correct-on-retry')
    expect(asker.shown).toContain('Lesson: The TTL constant is 7 days.')
  })

  it('still passes when a retry is wrong, recording taught but not yet understood', async () => {
    const llm = new FakeLlm({
      plan: [plan],
      grade: [
        { correct: false, feedback: 'You missed the retry flag.' },
        { correct: false, feedback: 'Still missing it.' },
      ],
      lesson: [{ lesson: 'The retry flag stops a second refresh.' }, { lesson: 'TTL is 7 days.' }],
    })
    const { asker, deps } = setup(['a', 'b', '1 hour', '30 days'], llm)
    const result = await runQuiz('pr', [chunk('src/auth.ts')], brief, deps)
    expect(result.status).toBe('passed')
    expect(result.score).toEqual({ firstTry: 0, onRetry: 0, taught: 2, total: 2 })
    expect(asker.shown).toContain('The expected answer: 7 days')
  })

  it('returns nothing-to-check without calling the AI when no chunk is left', async () => {
    const llm = new FakeLlm({})
    const { log, deps } = setup([], llm)
    const result = await runQuiz('check', [], brief, deps)
    expect(result.status).toBe('nothing-to-check')
    expect(llm.requests).toHaveLength(0)
    expect(log).toEqual([])
  })

  it('reports chunks over the budget as not quizzed but covered', async () => {
    const llm = new FakeLlm({ plan: [plan], grade: [{ correct: true, feedback: '' }] })
    const { log, deps } = setup(['a', '7 days'], llm)
    const result = await runQuiz('check', [chunk('a.ts', 20), chunk('b.ts', 20)], brief, deps, 100)
    expect(result.notQuizzed).toEqual(['b.ts-1', 'b.ts-2'])
    expect(result.notQuizzedChunks).toBe(1)
    expect(log.at(-1)).toBe('passed:2:1')
  })

  it('marks the run abandoned and rethrows when the user presses Ctrl-C', async () => {
    const llm = new FakeLlm({ plan: [plan] })
    const { log, deps } = setup([new MuellimError('aborted')], llm)
    await expect(runQuiz('check', [chunk('src/auth.ts')], brief, deps)).rejects.toMatchObject({
      code: 'aborted',
    })
    expect(log.at(-1)).toBe('abandoned')
  })
})

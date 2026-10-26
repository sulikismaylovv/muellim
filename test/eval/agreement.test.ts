import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { type EvalFixture, evalFixtureSchema, measureAgreement } from '../../eval/agreement.js'

const dir = new URL('../../eval/fixtures/', import.meta.url)

function load(): EvalFixture[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => evalFixtureSchema.parse(JSON.parse(readFileSync(new URL(name, dir), 'utf8'))))
}

describe('eval fixtures', () => {
  it('all parse and each has accepted and wrong answers', () => {
    const fixtures = load()
    expect(fixtures.length).toBeGreaterThanOrEqual(3)
    for (const f of fixtures) {
      expect(f.answers.some((a) => a.accepted)).toBe(true)
      expect(f.answers.some((a) => !a.accepted)).toBe(true)
    }
  })
})

describe('measureAgreement', () => {
  it('is 1 for a grader that matches every accepted grade', async () => {
    const fixtures = load()
    const truth = new Map(fixtures.flatMap((f) => f.answers.map((a) => [a.text, a.accepted])))
    const report = await measureAgreement(fixtures, async (_q, answer) => ({
      correct: truth.get(answer) ?? false,
      feedback: '',
    }))
    expect(report.agreement).toBe(1)
    expect(report.disagreements).toEqual([])
  })

  it('counts and lists each disagreement', async () => {
    const fixtures = load()
    const total = fixtures.reduce((n, f) => n + f.answers.length, 0)
    const report = await measureAgreement(fixtures, async () => ({ correct: true, feedback: '' }))
    const wrong = fixtures.reduce((n, f) => n + f.answers.filter((a) => !a.accepted).length, 0)
    expect(report.disagreements).toHaveLength(wrong)
    expect(report.agreement).toBeCloseTo((total - wrong) / total)
  })
})

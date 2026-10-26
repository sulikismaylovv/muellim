import { describe, expect, it } from 'vitest'
import { gradePrompt, planPrompt } from '../../src/engine/prompts.js'
import { planSchema, toQuestions } from '../../src/engine/schemas.js'

const open = {
  kind: 'open',
  topic: 'refresh flow',
  prompt: 'What happens when the access token has expired?',
  choices: [],
  answerKey: 'The client calls refresh() and retries once.',
  rubric: ['calls refresh()', 'retries once'],
}

const choice = {
  kind: 'choice',
  topic: 'token lifetime',
  prompt: 'How long does a refresh token live?',
  choices: ['1 hour', '7 days', '30 days'],
  answerKey: '7 days',
  rubric: [],
}

describe('planSchema', () => {
  it('accepts a mixed plan and turns it into questions with ids', () => {
    const plan = planSchema.parse({ questions: [open, choice] })
    expect(toQuestions(plan).map((q) => [q.id, q.kind, q.choices.length])).toEqual([
      ['q1', 'open', 0],
      ['q2', 'choice', 3],
    ])
  })

  it('rejects a choice question whose answer key is not a choice', () => {
    const bad = { ...choice, answerKey: '14 days' }
    expect(planSchema.safeParse({ questions: [bad] }).success).toBe(false)
  })

  it('rejects an open question without rubric points', () => {
    expect(planSchema.safeParse({ questions: [{ ...open, rubric: [] }] }).success).toBe(false)
  })

  it('rejects more than five questions', () => {
    expect(planSchema.safeParse({ questions: Array(6).fill(open) }).success).toBe(false)
  })
})

describe('prompts', () => {
  it('puts the brief and the limit into the plan prompt', () => {
    const text = planPrompt('### [1] src/a.ts', { goal: 'add refresh', focus: ['auth'] }, 5)
    expect(text).toContain('Goal of this work: add refresh')
    expect(text).toContain('checked on: auth')
    expect(text).toContain('at most 5 questions')
  })

  it('gives the grader the key and rubric', () => {
    const [q] = toQuestions(planSchema.parse({ questions: [open] }))
    if (!q) throw new Error('no question')
    const text = gradePrompt(q, 'it refreshes')
    expect(text).toContain('Expected answer: The client calls refresh() and retries once.')
    expect(text).toContain('- retries once')
    expect(text).toContain("Developer's answer: it refreshes")
  })
})

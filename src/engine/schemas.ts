import { z } from 'zod'
import type { Question } from '../types.js'

export const MAX_QUESTIONS = 5

export const plannedQuestionSchema = z
  .object({
    kind: z.enum(['open', 'choice']),
    topic: z.string().min(1),
    prompt: z.string().min(1),
    choices: z.array(z.string().min(1)).max(5),
    answerKey: z.string().min(1),
    rubric: z.array(z.string().min(1)).max(3),
  })
  .superRefine((q, ctx) => {
    if (q.kind === 'choice' && (q.choices.length < 2 || !q.choices.includes(q.answerKey))) {
      ctx.addIssue({
        code: 'custom',
        message: 'a choice question needs 2 to 5 choices, and answerKey must be one of them',
      })
    }
    if (q.kind === 'open' && q.rubric.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'an open question needs 1 to 3 rubric points' })
    }
  })

export const planSchema = z.object({
  questions: z.array(plannedQuestionSchema).min(1).max(MAX_QUESTIONS),
})

export const gradeSchema = z.object({ correct: z.boolean(), feedback: z.string() })

export const lessonSchema = z.object({ lesson: z.string().min(1) })

export type Plan = z.infer<typeof planSchema>

export function toQuestions(plan: Plan): Question[] {
  return plan.questions.map((q, i) => ({
    id: `q${i + 1}`,
    kind: q.kind,
    topic: q.topic,
    prompt: q.prompt,
    choices: q.kind === 'choice' ? q.choices : [],
    answerKey: q.answerKey,
    rubric: q.kind === 'open' ? q.rubric : [],
  }))
}

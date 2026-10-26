import { z } from 'zod'
import type { Grade, Question } from '../src/types.js'

/** The share of answers where Muellim's grade must match the accepted grade. */
export const TARGET_AGREEMENT = 0.9

export const evalFixtureSchema = z.object({
  name: z.string().min(1),
  /** Where the change comes from: "synthetic seed" or a link to the real pull request. */
  source: z.string().min(1),
  diff: z.string().min(1),
  question: z.object({
    id: z.string(),
    kind: z.literal('open'),
    topic: z.string(),
    prompt: z.string(),
    choices: z.array(z.string()).length(0),
    answerKey: z.string(),
    rubric: z.array(z.string()).min(1),
  }),
  answers: z
    .array(z.object({ text: z.string().min(1), accepted: z.boolean() }))
    .min(2)
    .refine((answers) => answers.some((a) => a.accepted) && answers.some((a) => !a.accepted), {
      message: 'each fixture needs at least one accepted and one wrong answer',
    }),
})

export type EvalFixture = z.infer<typeof evalFixtureSchema>

export interface CaseResult {
  fixture: string
  answer: string
  expected: boolean
  got: boolean
}

export interface AgreementReport {
  agreement: number
  cases: CaseResult[]
  disagreements: CaseResult[]
}

/** Grades every answer of every fixture and compares it with the accepted grade. */
export async function measureAgreement(
  fixtures: EvalFixture[],
  grade: (question: Question, answer: string) => Promise<Grade>,
): Promise<AgreementReport> {
  const cases: CaseResult[] = []
  for (const fixture of fixtures) {
    for (const answer of fixture.answers) {
      const got = (await grade(fixture.question, answer.text)).correct
      cases.push({ fixture: fixture.name, answer: answer.text, expected: answer.accepted, got })
    }
  }
  const disagreements = cases.filter((c) => c.expected !== c.got)
  const agreement = cases.length === 0 ? 0 : (cases.length - disagreements.length) / cases.length
  return { agreement, cases, disagreements }
}

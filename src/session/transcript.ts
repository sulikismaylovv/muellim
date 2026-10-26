import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { en } from '../strings/en.js'
import type { Chunk, Question, QuestionResult, RunKind, Score } from '../types.js'
import { STATE_DIR } from './store.js'

/** Appends each run to `.muellim/transcript.md`. Spec 3 renders this file as the PDF. */
export interface Transcript {
  begin(kind: RunKind): Promise<void>
  /** Called before the first question is shown, so the keys are on disk before any answer. */
  answerKeys(questions: Question[]): Promise<void>
  result(index: number, result: QuestionResult): Promise<void>
  /** Lists the chunks over the question limit, which count as covered without a question. */
  passed(score: Score, notQuizzed: readonly Chunk[]): Promise<void>
  abandoned(): Promise<void>
}

export function createTranscript(root: string, now: () => Date = () => new Date()): Transcript {
  const t = en.transcript
  const append = async (lines: string[]) => {
    await mkdir(join(root, STATE_DIR), { recursive: true })
    await appendFile(join(root, STATE_DIR, 'transcript.md'), `${lines.join('\n')}\n\n`)
  }
  return {
    begin: (kind) => append([t.runHeading(kind, now().toISOString())]),

    answerKeys: (questions) =>
      append([
        t.keysHeading,
        '',
        ...questions.flatMap((q, i) => [
          t.keyLine(i + 1, q.kind, q.prompt),
          ...(q.choices.length > 0 ? [t.choicesLine(q.choices)] : []),
          t.expectedLine(q.answerKey),
        ]),
      ]),

    result: (index, r) =>
      append([
        t.questionHeading(index, r.question.topic),
        '',
        t.firstAnswer(r.firstAnswer),
        t.feedback(r.firstGrade.feedback),
        ...(r.lesson === undefined ? [] : [t.lesson(r.lesson)]),
        ...(r.retryAnswer === undefined ? [] : [t.retryAnswer(r.retryAnswer)]),
        t.outcome(r.outcome),
      ]),

    passed: (score, notQuizzed) =>
      append([
        t.passed(score),
        ...(notQuizzed.length > 0
          ? [
              '',
              t.notQuizzed(notQuizzed.length),
              ...notQuizzed.map((c) => t.notQuizzedLine(c.file, c.header)),
            ]
          : []),
      ]),

    abandoned: () => append([t.abandoned]),
  }
}

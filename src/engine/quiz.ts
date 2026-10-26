import type { LlmClient, LookupTools } from '../providers/llm.js'
import type { Transcript } from '../session/transcript.js'
import { en } from '../strings/en.js'
import type {
  Brief,
  Grade,
  Question,
  QuestionResult,
  RankedChunk,
  RunKind,
  RunResult,
  Score,
} from '../types.js'
import type { Asker } from '../ui/terminal.js'
import { BUNDLE_CHAR_BUDGET, buildBundle } from './context.js'
import {
  GRADE_SYSTEM,
  gradePrompt,
  LESSON_SYSTEM,
  lessonPrompt,
  PLAN_SYSTEM,
  planPrompt,
} from './prompts.js'
import { gradeSchema, lessonSchema, planSchema, toQuestions } from './schemas.js'

export interface QuizDeps {
  llm: LlmClient
  asker: Asker
  transcript: Transcript
  lookups: LookupTools
}

/** Choice questions are graded locally. Only open answers go to the AI. */
export async function grade(llm: LlmClient, question: Question, answer: string): Promise<Grade> {
  if (question.kind === 'choice') {
    return { correct: answer === question.answerKey, feedback: '' }
  }
  return llm.generate({
    purpose: 'grade',
    system: GRADE_SYSTEM,
    prompt: gradePrompt(question, answer),
    schema: gradeSchema,
  })
}

export function scoreOf(results: QuestionResult[]): Score {
  const count = (outcome: QuestionResult['outcome']) =>
    results.filter((r) => r.outcome === outcome).length
  return {
    firstTry: count('correct'),
    onRetry: count('correct-on-retry'),
    taught: count('taught-not-understood'),
    total: results.length,
  }
}

/** The result of a run with nothing left to quiz. It makes no AI call. */
export function emptyResult(kind: RunKind): RunResult {
  return {
    kind,
    status: 'nothing-to-check',
    results: [],
    score: scoreOf([]),
    quizzed: [],
    notQuizzed: [],
    notQuizzedChunks: 0,
    usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
  }
}

async function ask(asker: Asker, question: Question): Promise<string> {
  if (question.kind === 'choice') return asker.askChoice(question)
  asker.show(question.prompt)
  return asker.askText(en.quiz.answerPrompt, true)
}

async function quizOne(deps: QuizDeps, question: Question): Promise<QuestionResult> {
  const { llm, asker } = deps
  const firstAnswer = await ask(asker, question)
  const firstGrade = await grade(llm, question, firstAnswer)
  if (firstGrade.correct) {
    asker.show(en.quiz.correct)
    return { question, firstAnswer, firstGrade, outcome: 'correct' }
  }
  asker.show(en.quiz.incorrect(firstGrade.feedback))
  const { lesson } = await llm.generate({
    purpose: 'lesson',
    system: LESSON_SYSTEM,
    prompt: lessonPrompt(question, firstAnswer, firstGrade.feedback),
    schema: lessonSchema,
  })
  asker.show(en.quiz.lesson(lesson))
  asker.show(en.quiz.retry)
  const retryAnswer = await ask(asker, question)
  const retryGrade = await grade(llm, question, retryAnswer)
  asker.show(retryGrade.correct ? en.quiz.correct : en.quiz.expected(question.answerKey))
  return {
    question,
    firstAnswer,
    firstGrade,
    lesson,
    retryAnswer,
    retryGrade,
    // The run still passes: every miss got its lesson and its retry (owner ruling).
    outcome: retryGrade.correct ? 'correct-on-retry' : 'taught-not-understood',
  }
}

/**
 * Plans up to five questions about the riskiest chunks, asks them, teaches each miss once
 * and records everything. Any error marks the transcript run as abandoned and is rethrown.
 */
export async function runQuiz(
  kind: RunKind,
  ranked: RankedChunk[],
  brief: Brief,
  deps: QuizDeps,
  budget = BUNDLE_CHAR_BUDGET,
): Promise<RunResult> {
  if (ranked.length === 0) return emptyResult(kind)
  const bundle = buildBundle(ranked, budget)
  await deps.transcript.begin(kind)
  try {
    deps.asker.show(en.check.preparing)
    const plan = await deps.llm.generate({
      purpose: 'plan',
      system: PLAN_SYSTEM,
      prompt: planPrompt(bundle.text, brief),
      schema: planSchema,
      lookups: deps.lookups,
    })
    const questions = toQuestions(plan)
    await deps.transcript.answerKeys(questions)
    const results: QuestionResult[] = []
    for (const [i, question] of questions.entries()) {
      deps.asker.show(en.quiz.header(i + 1, questions.length, question.topic))
      const result = await quizOne(deps, question)
      await deps.transcript.result(i + 1, result)
      results.push(result)
    }
    const score = scoreOf(results)
    await deps.transcript.passed(score, bundle.notQuizzed.length)
    return {
      kind,
      status: 'passed',
      results,
      score,
      quizzed: bundle.quizzed.flatMap((c) => c.lineKeys),
      notQuizzed: bundle.notQuizzed.flatMap((c) => c.lineKeys),
      notQuizzedChunks: bundle.notQuizzed.length,
      usage: deps.llm.usage(),
    }
  } catch (error) {
    await deps.transcript.abandoned()
    throw error
  }
}

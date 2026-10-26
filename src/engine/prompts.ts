import type { Brief, Question } from '../types.js'
import { MAX_QUESTIONS } from './schemas.js'

// Prompts go to the AI, not to the user, so they live here rather than in src/strings.

export const PLAN_SYSTEM = `You are Muellim, a patient teacher. A developer is about to merge a code change, often written by an AI agent. Your job is to check that they understand it.

Write questions about the change you are given:
- Ask about behaviour and design with "open" questions: ask the developer to predict what the code does in a concrete situation, or why it is built this way. Give 1 to 3 rubric points a correct answer must make.
- Ask about exact details with "choice" questions: a value, a condition, a name or an order. Give 3 or 4 plausible choices. answerKey must be the exact text of the correct choice. rubric is empty.
- Every question must be answerable from the change and its context. Never reveal the answer in the question.
- Start with the highest-risk parts. Prefer the areas the developer asked to be checked on, but do not skip a risky part outside them.
- topic is a short noun phrase. answerKey is short.
- You may use the lookup tools, at most 3 times, only when the change alone is not enough.`

export const GRADE_SYSTEM = `You grade one answer from a developer about their own code change. Judge meaning, not wording: an answer is correct when it makes every rubric point, even in other words or briefly. It is wrong when it misses a point or states something false about the code. feedback is one or two sentences addressed to the developer. Do not give the full answer away in feedback.`

export const LESSON_SYSTEM = `You teach a developer the part of their code change they did not understand. Explain the correct answer and why it holds, using the specific code. Keep it under 120 words, plain and concrete, addressed to the developer.`

export function planPrompt(bundleText: string, brief: Brief, maxQuestions = MAX_QUESTIONS): string {
  const focus = brief.focus.length > 0 ? brief.focus.join(', ') : 'none given'
  return [
    `Goal of this work: ${brief.goal || 'not given'}`,
    `Areas the developer wants to be checked on: ${focus}`,
    `Write at most ${maxQuestions} questions.`,
    '',
    'The change, highest risk first:',
    '',
    bundleText,
  ].join('\n')
}

function questionText(q: Question): string {
  const lines = [`Question (${q.kind}): ${q.prompt}`]
  if (q.choices.length > 0) lines.push(`Choices: ${q.choices.join(' | ')}`)
  lines.push(`Expected answer: ${q.answerKey}`)
  if (q.rubric.length > 0) lines.push(`Rubric: ${q.rubric.map((r) => `- ${r}`).join('\n')}`)
  return lines.join('\n')
}

export function gradePrompt(q: Question, answer: string): string {
  return `${questionText(q)}\n\nDeveloper's answer: ${answer}`
}

export function lessonPrompt(q: Question, answer: string, feedback: string): string {
  return `${questionText(q)}\n\nDeveloper's answer: ${answer}\nWhat was wrong: ${feedback}`
}

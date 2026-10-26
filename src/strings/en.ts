import type { ErrorCode } from '../errors.js'
import type { Outcome, RunKind, Score } from '../types.js'

const scoreLine = (s: Score) =>
  `${s.firstTry} right first time, ${s.onRetry} right on retry, ${s.taught} taught but not yet understood.`

const outcomeLabels: Record<Outcome, string> = {
  correct: 'correct',
  'correct-on-retry': 'correct on retry',
  'taught-not-understood': 'taught, not yet understood',
}

const errors: Record<ErrorCode, string> = {
  'not-git': 'This folder is not inside a git repository.',
  'no-session': 'No session found. Run "muellim start" first.',
  'missing-key':
    'No AI key found. Set ANTHROPIC_API_KEY, or MUELLIM_BASE_URL for an OpenAI-compatible server.',
  'missing-model': 'Set MUELLIM_MODEL to the model your OpenAI-compatible server should use.',
  'provider-unreachable':
    'The AI service could not be reached. Check your key, URL and network, then run again.',
  'bad-output':
    'The AI twice returned an answer Muellim could not read. Nothing was marked as passed.',
  budget: 'This run reached its limit of AI calls or tokens. Nothing was marked as passed.',
  'gh-auth': 'The GitHub CLI is missing or not signed in. Run "gh auth login", then try again.',
  'gh-failed': 'The GitHub CLI could not fetch that pull request.',
  aborted: 'Run stopped. Nothing was marked as passed. The partial transcript is kept.',
}

/** Every user-facing string. No other file prints text of its own. */
export const en = {
  cli: {
    description: 'Quizzes you on the code in your change and teaches the parts you got wrong.',
    start: 'Start a session: record where the branch began and write a short brief.',
    goal: 'what you are building, instead of being asked',
    focus: 'comma-separated areas to be checked on, instead of being asked',
    check: 'Quiz the work since your last pass.',
    pr: 'Quiz what is left of a pull request and save the pass for the GitHub check.',
    prNumber: 'the pull request number',
    badNumber: 'Give the pull request as a positive whole number, for example 42.',
  },
  start: {
    goalPrompt: 'What are you building in this session?',
    focusPrompt:
      'Which areas should Muellim check you on? Separate them with commas, or leave empty.',
    saved: (base: string) =>
      `Session started at ${base.slice(0, 7)}. Run "muellim check" whenever you want a quiz.`,
  },
  check: {
    nothing: 'Nothing new to check since your last pass.',
    preparing: 'Reading your change and preparing questions...',
    passed: (s: Score) => `Run complete: ${scoreLine(s)}`,
    notQuizzed: (n: number) =>
      `${n} lower-risk parts of the change were over the question limit and were not quizzed.`,
  },
  quiz: {
    header: (i: number, n: number, topic: string) => `Question ${i} of ${n}: ${topic}`,
    answerPrompt: 'Your answer:',
    correct: 'Correct.',
    incorrect: (feedback: string) => `Not quite. ${feedback}`,
    lesson: (text: string) => `Lesson: ${text}`,
    retry: 'Try once more:',
    expected: (key: string) => `The expected answer: ${key}`,
  },
  pr: {
    fetching: (n: number) => `Fetching pull request #${n}...`,
    saved: (n: number, path: string) => `Pass for #${n} saved to ${path}.`,
  },
  transcript: {
    runHeading: (kind: RunKind, at: string) => `## ${kind} run, ${at}`,
    keysHeading: '### Answer keys, written before any answer',
    keyLine: (i: number, kind: string, prompt: string) => `${i}. [${kind}] ${prompt}`,
    choicesLine: (choices: string[]) => `   - Choices: ${choices.join(' | ')}`,
    expectedLine: (key: string) => `   - Expected: ${key}`,
    questionHeading: (i: number, topic: string) => `### Question ${i}: ${topic}`,
    firstAnswer: (a: string) => `- First answer: ${a}`,
    feedback: (f: string) => `- Feedback: ${f}`,
    lesson: (l: string) => `- Lesson: ${l}`,
    retryAnswer: (a: string) => `- Retry answer: ${a}`,
    outcome: (o: Outcome) => `- Outcome: ${outcomeLabels[o]}`,
    passed: (s: Score) => `**Status:** passed. ${scoreLine(s)}`,
    notQuizzed: (n: number) => `${n} chunks over the question limit were not quizzed:`,
    notQuizzedLine: (file: string, header: string) => `- ${file} ${header}`,
    abandoned: '**Status:** abandoned. Nothing was marked as passed.',
  },
  errors,
}

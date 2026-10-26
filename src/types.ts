/** One hunk of a unified diff. */
export interface Chunk {
  file: string
  /** The `@@ ... @@` line, including the enclosing function name git adds. */
  header: string
  /** Hunk body lines, each with its ` `, `+` or `-` prefix. */
  lines: string[]
  added: number
  removed: number
  /** One key per added or removed line: stable across rebases, squashes and regrouped hunks. */
  lineKeys: string[]
}

export interface RankedChunk extends Chunk {
  score: number
  briefMatch: boolean
}

export interface Brief {
  goal: string
  focus: string[]
}

export interface Session {
  version: 1
  startedAt: string
  baseCommit: string
  brief: Brief
  /** Line keys of every chunk a passed run covered. */
  passed: string[]
}

export type QuestionKind = 'open' | 'choice'

export interface Question {
  id: string
  kind: QuestionKind
  topic: string
  prompt: string
  /** Empty for open questions. */
  choices: string[]
  /** Open: a model answer. Choice: the text of the correct choice. */
  answerKey: string
  /** Open: the points a correct answer must make. Empty for choice questions. */
  rubric: string[]
}

export interface Grade {
  correct: boolean
  feedback: string
}

export type Outcome = 'correct' | 'correct-on-retry' | 'taught-not-understood'

export interface QuestionResult {
  question: Question
  firstAnswer: string
  firstGrade: Grade
  lesson?: string
  retryAnswer?: string
  retryGrade?: Grade
  outcome: Outcome
}

export interface Usage {
  calls: number
  inputTokens: number
  outputTokens: number
}

export interface Score {
  firstTry: number
  onRetry: number
  taught: number
  total: number
}

export type RunKind = 'check' | 'pr'

export type RunStatus = 'passed' | 'nothing-to-check'

export interface RunResult {
  kind: RunKind
  status: RunStatus
  results: QuestionResult[]
  score: Score
  /** Line keys of the chunks the questions were about. */
  quizzed: string[]
  /** Line keys of the chunks over the question limit. They count as covered. */
  notQuizzed: string[]
  notQuizzedChunks: number
  usage: Usage
}

/** What `muellim pr` writes for spec 2 to post. */
export interface PrPassResult {
  pullRequest: number
  headSha: string
  score: Score
  topics: string[]
  notQuizzedChunks: number
  createdAt: string
}

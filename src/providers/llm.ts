import type { z } from 'zod'
import type { Usage } from '../types.js'

/** Read-only views of the repository the AI may use while planning questions. */
export interface LookupTools {
  listFiles(dir: string): Promise<string>
  readFile(path: string, fromLine: number, toLine: number): Promise<string>
  search(text: string): Promise<string>
}

export type Purpose = 'plan' | 'grade' | 'lesson'

export interface LlmRequest<T> {
  purpose: Purpose
  system: string
  prompt: string
  schema: z.ZodType<T>
  lookups?: LookupTools
}

/** The only way Muellim talks to an AI. Tests replace it with a fake. */
export interface LlmClient {
  generate<T>(request: LlmRequest<T>): Promise<T>
  usage(): Usage
}

export interface Limits {
  maxCalls: number
  maxTokens: number
}

export const DEFAULT_LIMITS: Limits = { maxCalls: 20, maxTokens: 200_000 }

/** At most this many lookups per plan request. */
export const MAX_LOOKUPS = 3

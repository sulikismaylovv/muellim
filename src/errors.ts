export type ErrorCode =
  | 'not-git'
  | 'no-session'
  | 'missing-key'
  | 'missing-model'
  | 'provider-unreachable'
  | 'bad-output'
  | 'budget'
  | 'gh-auth'
  | 'gh-failed'
  | 'aborted'

/** An expected failure. The CLI prints `en.errors[code]` and exits with code 1. */
export class MuellimError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, detail = '') {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'MuellimError'
    this.code = code
  }
}

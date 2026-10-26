import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { MuellimError } from '../errors.js'

export interface Gh {
  prDiff(pullRequest: number): Promise<string>
  prHead(pullRequest: number): Promise<string>
}

export type Exec = (file: string, args: string[], cwd: string) => Promise<{ stdout: string }>

const execFileAsync = promisify(execFile)

const defaultExec: Exec = (file, args, cwd) =>
  execFileAsync(file, args, { cwd, maxBuffer: 64 * 1024 * 1024 })

function toMuellimError(error: unknown): MuellimError {
  const failure = error as { code?: unknown; stderr?: string; message?: string }
  const stderr = failure.stderr ?? ''
  if (failure.code === 'ENOENT' || /gh auth login|not logged in|authentication/i.test(stderr)) {
    return new MuellimError('gh-auth', stderr.trim())
  }
  return new MuellimError('gh-failed', stderr.trim() || (failure.message ?? ''))
}

/** Reads a pull request through the user's own `gh` sign-in. */
export function createGh(cwd: string, exec: Exec = defaultExec): Gh {
  const gh = async (args: string[]) => {
    try {
      return (await exec('gh', args, cwd)).stdout
    } catch (error) {
      throw toMuellimError(error)
    }
  }
  return {
    prDiff: (n) => gh(['pr', 'diff', String(n), '--color', 'never']),
    prHead: async (n) =>
      (await gh(['pr', 'view', String(n), '--json', 'headRefOid', '--jq', '.headRefOid'])).trim(),
  }
}

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { MuellimError } from '../errors.js'

const run = promisify(execFile)

/** The hash of git's empty tree: the base for a repository with no commits. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** Fixed `a/` and `b/` paths whatever the user's diff config, so the path filters match. */
const PLAIN_DIFF = ['--no-color', '--src-prefix=a/', '--dst-prefix=b/']

export interface Git {
  readonly root: string
  /** Where the branch left the default branch, or HEAD when there is no default branch. */
  baseCommit(): Promise<string>
  /** Tracked changes since `base` (whole functions as context) plus untracked files. */
  diffSince(base: string): Promise<string>
  isTracked(path: string): Promise<boolean>
  listFiles(dir: string): Promise<string[]>
  /** Fixed-string search over tracked files: `path:line:text`, at most 50 lines. */
  grep(text: string): Promise<string[]>
  /** How many times tracked files mention `word` as a whole word. */
  countWord(word: string): Promise<number>
  readFile(path: string): Promise<string>
}

async function git(cwd: string, args: string[], okCodes: number[] = [0]): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
    return stdout
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: string }
    if (typeof failure.code === 'number' && okCodes.includes(failure.code)) {
      return failure.stdout ?? ''
    }
    throw error
  }
}

/** Finds the repository root above `cwd`. Throws `not-git` outside a repository. */
export async function openGit(cwd: string): Promise<Git> {
  let root: string
  try {
    root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    throw new MuellimError('not-git')
  }
  return createGit(root)
}

export function createGit(root: string): Git {
  return {
    root,

    async baseCommit() {
      for (const ref of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
        try {
          const base = (await git(root, ['merge-base', 'HEAD', ref])).trim()
          if (base) return base
        } catch {
          // Try the next candidate.
        }
      }
      try {
        return (await git(root, ['rev-parse', 'HEAD'])).trim()
      } catch {
        return EMPTY_TREE
      }
    },

    async diffSince(base) {
      const tracked = await git(root, [
        'diff',
        ...PLAIN_DIFF,
        '--no-ext-diff',
        '--function-context',
        base,
      ])
      const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z']))
        .split('\0')
        .filter(Boolean)
      const added: string[] = []
      for (const path of untracked) {
        added.push(
          await git(root, ['diff', ...PLAIN_DIFF, '--no-index', '--', '/dev/null', path], [0, 1]),
        )
      }
      return [tracked, ...added].join('')
    },

    async isTracked(path) {
      const out = await git(root, ['ls-files', '-z', '--', path])
      return out.split('\0').includes(path)
    },

    async listFiles(dir) {
      const out = await git(root, ['ls-files', '-z', '--', dir === '' ? '.' : dir])
      return out.split('\0').filter(Boolean).slice(0, 200)
    },

    async grep(text) {
      const out = await git(root, ['grep', '-n', '-I', '-F', '--max-count=5', '-e', text], [0, 1])
      return out.split('\n').filter(Boolean).slice(0, 50)
    },

    async countWord(word) {
      const out = await git(root, ['grep', '-c', '-w', '-F', '-e', word], [0, 1])
      return out
        .split('\n')
        .filter(Boolean)
        .reduce((sum, line) => sum + Number(line.slice(line.lastIndexOf(':') + 1)), 0)
    },

    readFile(path) {
      return readFile(join(root, path), 'utf8')
    },
  }
}

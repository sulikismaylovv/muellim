import { realpath } from 'node:fs/promises'
import { isAbsolute, join, posix, relative } from 'node:path'
import { unquotePath } from '../diff/chunks.js'
import { isAllowedPath } from '../diff/filter.js'
import type { Git } from '../git/git.js'
import { type LookupTools, MAX_LOOKUPS } from '../providers/llm.js'
import type { RankedChunk } from '../types.js'

export const BUNDLE_CHAR_BUDGET = 24_000
const READ_LINE_CAP = 200

export interface Bundle {
  /** The chunks the questions may be about, highest risk first. */
  quizzed: RankedChunk[]
  /** Chunks over the budget. They are listed in the transcript and count as covered. */
  notQuizzed: RankedChunk[]
  text: string
}

function render(chunk: RankedChunk, index: number): string {
  return [`### [${index + 1}] ${chunk.file}`, chunk.header, ...chunk.lines, ''].join('\n')
}

/** Takes ranked chunks in order until the character budget is spent. The first always goes in. */
export function buildBundle(ranked: RankedChunk[], budget = BUNDLE_CHAR_BUDGET): Bundle {
  const quizzed: RankedChunk[] = []
  const parts: string[] = []
  let used = 0
  for (const chunk of ranked) {
    const part = render(chunk, quizzed.length)
    const cost = part.length + (quizzed.length > 0 ? 1 : 0)
    if (quizzed.length > 0 && used + cost > budget) break
    quizzed.push(chunk)
    parts.push(quizzed.length === 1 ? part.slice(0, budget) : part)
    used += cost
  }
  return { quizzed, notQuizzed: ranked.slice(quizzed.length), text: parts.join('\n') }
}

export const LOOKUP_LIMIT_REACHED = 'Lookup limit reached. Write the questions with what you have.'
export const NOT_AVAILABLE = 'Not available.'

/** Read-only lookups confined to tracked, non-secret, non-ignored files of the repository. */
export function createLookups(git: Git, ignore: RegExp[]): LookupTools & { used(): number } {
  let count = 0
  const allowed = async (path: string): Promise<boolean> => {
    const clean = posix.normalize(path)
    if (clean.startsWith('..') || posix.isAbsolute(clean)) return false
    return isAllowedPath(clean, ignore) && (await git.isTracked(clean))
  }
  /** False when the file's real path leaves the repository, is not allowed, or is not tracked. */
  const realAllowed = async (clean: string): Promise<boolean> => {
    try {
      const root = await realpath(git.root)
      const rel = relative(root, await realpath(join(root, clean)))
      if (rel.startsWith('..') || isAbsolute(rel) || !isAllowedPath(rel, ignore)) return false
      return rel.normalize('NFC') === clean.normalize('NFC') || (await git.isTracked(rel))
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
    }
  }
  const hitPath = (hit: string): string | undefined => {
    if (!hit.startsWith('"')) return hit.slice(0, hit.indexOf(':'))
    for (let i = 1; i < hit.length; i++) {
      if (hit[i] === '\\') i++
      else if (hit[i] === '"') return unquotePath(hit.slice(0, i + 1))
    }
    return undefined
  }
  /** False when the hit's real path leaves the repository, is not allowed, or crossed a link to an
   * untracked file; ENOENT keeps it. */
  const realInside = async (path: string): Promise<boolean> => {
    try {
      const root = await realpath(git.root)
      const rel = relative(root, await realpath(join(root, path)))
      if (rel.startsWith('..') || isAbsolute(rel) || !isAllowedPath(rel, ignore)) return false
      return rel.normalize('NFC') === path.normalize('NFC') || (await git.isTracked(rel))
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
    }
  }
  const spend = (): boolean => {
    count++
    return count <= MAX_LOOKUPS
  }
  return {
    used: () => count,

    async listFiles(dir) {
      if (!spend()) return LOOKUP_LIMIT_REACHED
      const clean = posix.normalize(dir === '' ? '.' : dir)
      if (clean.startsWith('..') || posix.isAbsolute(clean)) return NOT_AVAILABLE
      const files = await git.listFiles(clean)
      return files.filter((f) => isAllowedPath(f, ignore)).join('\n') || NOT_AVAILABLE
    },

    async readFile(path, fromLine, toLine) {
      if (!spend()) return LOOKUP_LIMIT_REACHED
      if (!(await allowed(path))) return NOT_AVAILABLE
      const clean = posix.normalize(path)
      if (!(await realAllowed(clean))) return NOT_AVAILABLE
      let content: string
      try {
        content = await git.readFile(clean)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return NOT_AVAILABLE
        throw error
      }
      if (!Number.isFinite(fromLine) || !Number.isFinite(toLine)) return ''
      const lines = content.split('\n')
      const from = Math.max(1, Math.floor(fromLine))
      const to = Math.max(
        from - 1,
        Math.min(lines.length, Math.floor(toLine), from + READ_LINE_CAP - 1),
      )
      return lines
        .slice(from - 1, to)
        .map((line, i) => `${from + i}: ${line}`)
        .join('\n')
    },

    async search(text) {
      if (!spend()) return LOOKUP_LIMIT_REACHED
      const hits = await git.grep(text)
      const safe: string[] = []
      for (const hit of hits) {
        const path = hitPath(hit)
        if (path !== undefined && isAllowedPath(path, ignore) && (await realInside(path)))
          safe.push(hit)
      }
      return safe.join('\n') || NOT_AVAILABLE
    },
  }
}

import { createHash } from 'node:crypto'
import type { Chunk } from '../types.js'

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/

const SIMPLE_ESCAPES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
  '"': 0x22,
  '\\': 0x5c,
}

/** A key for one added or removed line. It ignores line numbers and trailing spaces. */
export function lineKey(file: string, line: string): string {
  return createHash('sha256').update(`${file}\0${line.trimEnd()}`).digest('hex').slice(0, 16)
}

/** Decodes a path git wrapped in double quotes (C escapes, UTF-8 bytes); other paths come back unchanged. */
export function unquotePath(path: string): string {
  if (path.length < 2 || !path.startsWith('"') || !path.endsWith('"')) return path
  const encoder = new TextEncoder()
  const bytes: number[] = []
  // One token is an octal escape, a simple escape, a run of plain text, or a lone backslash.
  for (const match of path.slice(1, -1).matchAll(/\\([0-7]{3})|\\(["\\abfnrtv])|[^\\]+|\\/gu)) {
    const [token, octal, simple] = match
    if (octal !== undefined) bytes.push(Number.parseInt(octal, 8))
    else if (simple !== undefined) bytes.push(SIMPLE_ESCAPES[simple] ?? 0x5c)
    else bytes.push(...encoder.encode(token))
  }
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

/** Splits a unified diff (git or GitHub) into one chunk per hunk. */
export function parseDiff(diff: string): Chunk[] {
  const chunks: Chunk[] = []
  let file: string | null = null
  let current: Chunk | null = null
  let oldLeft = 0
  let newLeft = 0

  for (const line of diff.split('\n')) {
    // Inside a hunk the header counts decide what a line is, so a removed "-- comment" stays a body line.
    if (current && (oldLeft > 0 || newLeft > 0)) {
      const sign = line.charAt(0)
      if (sign === '\\') continue
      if (sign === '+') {
        current.added++
        current.lineKeys.push(lineKey(current.file, line))
        newLeft--
      } else if (sign === '-') {
        current.removed++
        current.lineKeys.push(lineKey(current.file, line))
        oldLeft--
      } else {
        oldLeft--
        newLeft--
      }
      current.lines.push(line === '' ? ' ' : line)
      continue
    }
    if (line.startsWith('diff --git ')) {
      file = null
      current = null
    } else if (line.startsWith('--- ')) {
      const path = line.slice(4).trim()
      if (path !== '/dev/null') file = unquotePath(path).replace(/^a\//, '')
    } else if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim()
      if (path !== '/dev/null') file = unquotePath(path).replace(/^b\//, '')
    } else if (file) {
      const match = HUNK_HEADER.exec(line)
      if (match) {
        current = { file, header: line, lines: [], added: 0, removed: 0, lineKeys: [] }
        chunks.push(current)
        oldLeft = Number(match[1] ?? '1')
        newLeft = Number(match[2] ?? '1')
      }
    }
  }
  return chunks.filter((c) => c.lineKeys.length > 0)
}

/** True when every changed line of the chunk is already in `passed`. */
export function isCovered(chunk: Chunk, passed: ReadonlySet<string>): boolean {
  return chunk.lineKeys.every((key) => passed.has(key))
}

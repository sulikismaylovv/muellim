import { describe, expect, it } from 'vitest'
import { isCovered, lineKey, parseDiff, unquotePath } from '../../src/diff/chunks.js'

const DIFF = [
  'diff --git a/src/auth.ts b/src/auth.ts',
  'index 1111111..2222222 100644',
  '--- a/src/auth.ts',
  '+++ b/src/auth.ts',
  '@@ -10,3 +10,4 @@ export function login(user: User) {',
  '   const token = sign(user)',
  '-  return token',
  '+  audit(user.id)',
  '+  return refresh(token)',
  ' }',
  '@@ -40,3 +41,3 @@ export function logout() {',
  '-  -- old sql comment',
  '+  clear()',
  '   return true',
  ' }',
  'diff --git a/db/drop.sql b/db/drop.sql',
  'deleted file mode 100644',
  'index 3333333..0000000',
  '--- a/db/drop.sql',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '--- remove everything',
  '-DROP TABLE users;',
  '',
].join('\n')

describe('parseDiff', () => {
  it('makes one chunk per hunk with file, header and counts', () => {
    const chunks = parseDiff(DIFF)
    expect(chunks.map((c) => [c.file, c.added, c.removed])).toEqual([
      ['src/auth.ts', 2, 1],
      ['src/auth.ts', 1, 1],
      ['db/drop.sql', 0, 2],
    ])
    expect(chunks[0]?.header).toBe('@@ -10,3 +10,4 @@ export function login(user: User) {')
    expect(chunks[0]?.lines).toHaveLength(5)
  })

  it('reads a removed line that starts with "--" as body, not as a file header', () => {
    const chunks = parseDiff(DIFF)
    expect(chunks[1]?.file).toBe('src/auth.ts')
    expect(chunks[1]?.lines[0]).toBe('-  -- old sql comment')
    expect(chunks[2]?.lines[0]).toBe('--- remove everything')
  })

  it('keeps the same line keys when line numbers and trailing spaces change', () => {
    const moved = DIFF.replace('@@ -10,3 +10,4 @@', '@@ -90,3 +90,4 @@').replace(
      '+  audit(user.id)',
      '+  audit(user.id)   ',
    )
    expect(parseDiff(moved)[0]?.lineKeys).toEqual(parseDiff(DIFF)[0]?.lineKeys)
  })

  it('returns no chunks for an empty diff', () => {
    expect(parseDiff('')).toEqual([])
  })
})

describe('isCovered', () => {
  it('is true only when every changed line is passed', () => {
    const [chunk] = parseDiff(DIFF)
    if (!chunk) throw new Error('no chunk')
    const all = new Set(chunk.lineKeys)
    expect(isCovered(chunk, all)).toBe(true)
    all.delete(lineKey('src/auth.ts', '+  audit(user.id)'))
    expect(isCovered(chunk, all)).toBe(false)
  })
})

// git writes a non-ASCII name as C-quoted UTF-8 bytes: ö is \303\266 and ə is \311\231.
const QUOTED_NAME = String.raw`src/\303\266yr\311\231nm\311\231.ts`

describe('parseDiff with paths git quoted', () => {
  const quotedDiff = [
    `diff --git "a/${QUOTED_NAME}" "b/${QUOTED_NAME}"`,
    'index 7898192..6178079 100644',
    `--- "a/${QUOTED_NAME}"`,
    `+++ "b/${QUOTED_NAME}"`,
    '@@ -1 +1 @@',
    '-a',
    '+b',
    '',
  ].join('\n')

  it('returns the decoded file name and the same line keys as the unquoted diff', () => {
    const plainDiff = quotedDiff.split(QUOTED_NAME).join('src/öyrənmə.ts').replaceAll('"', '')
    const [quoted] = parseDiff(quotedDiff)
    const [plain] = parseDiff(plainDiff)
    expect(quoted?.file).toBe('src/öyrənmə.ts')
    expect(quoted?.lineKeys).toHaveLength(2)
    expect(quoted?.lineKeys).toEqual(plain?.lineKeys)
  })

  it('decodes a quoted --- path when the file was deleted', () => {
    const deleted = [
      `diff --git "a/${QUOTED_NAME}" "b/${QUOTED_NAME}"`,
      'deleted file mode 100644',
      `--- "a/${QUOTED_NAME}"`,
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-a',
      '',
    ].join('\n')
    expect(parseDiff(deleted).map((c) => c.file)).toEqual(['src/öyrənmə.ts'])
  })
})

describe('unquotePath', () => {
  it('returns an unquoted path unchanged', () => {
    expect(unquotePath('a/x.ts')).toBe('a/x.ts')
    expect(unquotePath('/dev/null')).toBe('/dev/null')
  })

  it('decodes octal escapes as UTF-8 bytes', () => {
    expect(unquotePath(`"b/${QUOTED_NAME}"`)).toBe('b/src/öyrənmə.ts')
  })

  it('decodes an escaped double quote, backslash and control characters', () => {
    expect(unquotePath(String.raw`"b/src/q\"t.ts"`)).toBe('b/src/q"t.ts')
    expect(unquotePath(String.raw`"a\\b"`)).toBe('a\\b')
    expect(unquotePath(String.raw`"a\tb\nc"`)).toBe('a\tb\nc')
  })
})

describe('parseDiff hunk edge cases', () => {
  it('reads a hunk header without counts as one line each side', () => {
    const diff = ['--- a/x.ts', '+++ b/x.ts', '@@ -1 +1 @@', '-a', '+b', ''].join('\n')
    expect(parseDiff(diff).map((c) => [c.file, c.added, c.removed])).toEqual([['x.ts', 1, 1]])
  })

  it('skips a "\\ No newline at end of file" line inside the hunk', () => {
    const diff = [
      'diff --git "a/src/q\\"t.ts" "b/src/q\\"t.ts"',
      '--- "a/src/q\\"t.ts"',
      '+++ "b/src/q\\"t.ts"',
      '@@ -1 +1 @@',
      '-y',
      '\\ No newline at end of file',
      '+z',
      '\\ No newline at end of file',
      '',
    ].join('\n')
    const [chunk] = parseDiff(diff)
    expect(chunk?.file).toBe('src/q"t.ts')
    expect([chunk?.added, chunk?.removed]).toEqual([1, 1])
    expect(chunk?.lines).toEqual(['-y', '+z'])
  })

  it('keeps a blank context line inside a hunk as a single space', () => {
    const diff = ['--- a/x.ts', '+++ b/x.ts', '@@ -1,3 +1,3 @@', ' a', '', '-b', '+c', ''].join(
      '\n',
    )
    const [chunk] = parseDiff(diff)
    expect(chunk?.lines).toEqual([' a', ' ', '-b', '+c'])
    expect([chunk?.added, chunk?.removed]).toEqual([1, 1])
  })
})

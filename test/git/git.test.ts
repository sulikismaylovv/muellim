import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseDiff } from '../../src/diff/chunks.js'
import { filterChunks, parseIgnore } from '../../src/diff/filter.js'
import { MuellimError } from '../../src/errors.js'
import { EMPTY_TREE, type Git, openGit } from '../../src/git/git.js'

let dir: string
const sh = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'muellim-git-')))
  sh('init', '-q', '-b', 'main')
  sh('config', 'user.email', 'test@example.com')
  sh('config', 'user.name', 'Test')
  sh('config', 'commit.gpgsign', 'false')
})

async function commitFile(path: string, text: string): Promise<void> {
  await mkdir(join(dir, path, '..'), { recursive: true })
  await writeFile(join(dir, path), text)
  sh('add', path)
  sh('commit', '-q', '-m', `add ${path}`)
}

describe('openGit', () => {
  it('throws not-git outside a repository', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'muellim-plain-'))
    await expect(openGit(outside)).rejects.toThrow(MuellimError)
  })

  it('uses the empty tree as the base of a repository with no commits', async () => {
    const git: Git = await openGit(dir)
    expect(git.root).toBe(dir)
    expect(await git.baseCommit()).toBe(EMPTY_TREE)
  })
})

describe('diffSince', () => {
  it('returns tracked edits and untracked files as one parsable diff', async () => {
    await commitFile('src/a.ts', 'export function a() {\n  return 1\n}\n')
    const git = await openGit(dir)
    const base = await git.baseCommit()
    await writeFile(join(dir, 'src/a.ts'), 'export function a() {\n  return 2\n}\n')
    await writeFile(join(dir, 'src/new.ts'), 'export const n = 1\n')
    const chunks = parseDiff(await git.diffSince(base))
    expect(chunks.map((c) => [c.file, c.added, c.removed])).toEqual([
      ['src/a.ts', 1, 1],
      ['src/new.ts', 1, 0],
    ])
  })

  it.each<Record<string, string>>([
    { 'diff.mnemonicPrefix': 'true' },
    { 'diff.srcPrefix': 'x/', 'diff.dstPrefix': 'y/' },
  ])(
    'keeps a/ and b/ paths under the user config %j, so the filters still match',
    async (config) => {
      for (const [key, value] of Object.entries(config)) sh('config', key, value)
      await commitFile('secrets/prod.yml', 'token: one\n')
      await commitFile('src/a.ts', 'export const a = 1\n')
      const git = await openGit(dir)
      const base = await git.baseCommit()
      await writeFile(join(dir, 'secrets/prod.yml'), 'token: two\n')
      await writeFile(join(dir, 'src/a.ts'), 'export const a = 2\n')
      await writeFile(join(dir, 'src/new.ts'), 'export const n = 1\n')
      await mkdir(join(dir, '.muellim'))
      await writeFile(join(dir, '.muellim/transcript.md'), '- Expected: 7 days\n')
      const chunks = parseDiff(await git.diffSince(base))
      const kept = filterChunks(chunks, parseIgnore('/secrets/\n'))
      expect(kept.map((c) => c.file)).toEqual(['src/a.ts', 'src/new.ts'])
    },
  )

  it('shows the whole enclosing function as context', async () => {
    const body = Array.from({ length: 12 }, (_, i) => `  const v${i} = ${i}`).join('\n')
    await commitFile('src/f.ts', `export function f() {\n${body}\n  return 0\n}\n`)
    const git = await openGit(dir)
    const base = await git.baseCommit()
    await writeFile(join(dir, 'src/f.ts'), `export function f() {\n${body}\n  return 1\n}\n`)
    const [chunk] = parseDiff(await git.diffSince(base))
    expect(chunk?.lines[0]).toBe(' export function f() {')
  })
})

describe('lookups support', () => {
  it('lists, searches and counts tracked files only', async () => {
    await commitFile('src/a.ts', 'export function refresh() {}\nrefresh()\n')
    await commitFile('src/b.ts', 'import { refresh } from "./a"\nrefresh()\n')
    await writeFile(join(dir, 'untracked.ts'), 'refresh()\n')
    const git = await openGit(dir)
    expect(await git.listFiles('src')).toEqual(['src/a.ts', 'src/b.ts'])
    expect(await git.isTracked('src/a.ts')).toBe(true)
    expect(await git.isTracked('untracked.ts')).toBe(false)
    expect(await git.grep('refresh()')).toContain('src/b.ts:2:refresh()')
    expect(await git.countWord('refresh')).toBe(4)
    expect(await git.countWord('missing_name')).toBe(0)
    expect(await git.readFile('src/b.ts')).toContain('import')
  })
})

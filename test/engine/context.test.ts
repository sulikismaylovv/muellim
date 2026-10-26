import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildBundle,
  createLookups,
  LOOKUP_LIMIT_REACHED,
  NOT_AVAILABLE,
} from '../../src/engine/context.js'
import { createGit, type Git } from '../../src/git/git.js'
import type { RankedChunk } from '../../src/types.js'

const ranked = (file: string, size: number): RankedChunk => ({
  file,
  header: '@@ -1 +1 @@',
  lines: Array.from({ length: size }, (_, i) => `+line ${i}`),
  added: size,
  removed: 0,
  lineKeys: [`${file}-k`],
  score: 1,
  briefMatch: false,
})

const files: Record<string, string> = {
  'src/a.ts': Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n'),
  '.env': 'SECRET=1',
  'gen/x.ts': 'generated',
}

const fakeGit: Git = {
  root: '/repo',
  baseCommit: async () => 'base',
  diffSince: async () => '',
  isTracked: async (path) => path in files,
  listFiles: async () => Object.keys(files),
  grep: async () => ['src/a.ts:1:token', '.env:1:token', 'gen/x.ts:1:token'],
  countWord: async () => 0,
  readFile: async (path) => files[path] ?? '',
}

describe('buildBundle', () => {
  it('fills the budget in rank order and leaves the rest as not quizzed', () => {
    const bundle = buildBundle([ranked('a.ts', 10), ranked('b.ts', 10), ranked('c.ts', 10)], 250)
    expect(bundle.quizzed.map((c) => c.file)).toEqual(['a.ts', 'b.ts'])
    expect(bundle.notQuizzed.map((c) => c.file)).toEqual(['c.ts'])
    expect(bundle.text).toContain('### [1] a.ts')
    expect(bundle.text).toContain('### [2] b.ts')
  })

  it('always includes the first chunk, cut to the budget', () => {
    const bundle = buildBundle([ranked('huge.ts', 5000)], 300)
    expect(bundle.quizzed).toHaveLength(1)
    expect(bundle.text.length).toBeLessThanOrEqual(300)
  })
})

describe('createLookups', () => {
  it('reads numbered lines of tracked files, at most 200 per call', async () => {
    const lookups = createLookups(fakeGit, [])
    const text = await lookups.readFile('src/a.ts', 10, 500)
    expect(text.split('\n')[0]).toBe('10: line 10')
    expect(text.split('\n')).toHaveLength(200)
  })

  it('refuses secrets, ignored files and paths outside the repository', async () => {
    const lookups = createLookups(fakeGit, [/^gen\//])
    expect(await lookups.readFile('.env', 1, 5)).toBe(NOT_AVAILABLE)
    expect(await lookups.readFile('../outside.ts', 1, 5)).toBe(NOT_AVAILABLE)
    expect(await lookups.search('token')).toBe('src/a.ts:1:token')
  })

  it('answers with the limit message after three lookups', async () => {
    const lookups = createLookups(fakeGit, [])
    await lookups.listFiles('src')
    await lookups.search('token')
    await lookups.readFile('src/a.ts', 1, 2)
    expect(await lookups.readFile('src/a.ts', 1, 2)).toBe(LOOKUP_LIMIT_REACHED)
    expect(lookups.used()).toBe(4)
  })

  it('hides secret files from listings', async () => {
    const lookups = createLookups(fakeGit, [])
    expect(await lookups.listFiles('.')).toBe('src/a.ts\ngen/x.ts')
  })
})

describe('rulings', () => {
  async function tempDirs(): Promise<[string, string]> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'muellim-ctx-')))
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'muellim-out-')))
    return [dir, outside]
  }
  const linkGit = (dir: string): Git => ({
    ...fakeGit,
    root: dir,
    isTracked: async () => true,
    readFile: async () => 'leaked',
  })

  it('refuses a tracked link to a file outside the repository', async () => {
    const [dir, outside] = await tempDirs()
    try {
      await writeFile(join(outside, 'a.ts'), 'secret')
      await symlink(join(outside, 'a.ts'), join(dir, 'link.ts'))
      const lookups = createLookups(linkGit(dir), [])
      expect(await lookups.readFile('link.ts', 1, 5)).toBe(NOT_AVAILABLE)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('refuses a tracked file under a folder that links outside', async () => {
    const [dir, outside] = await tempDirs()
    try {
      await writeFile(join(outside, 'b.ts'), 'secret')
      await symlink(outside, join(dir, 'lib'))
      const lookups = createLookups(linkGit(dir), [])
      expect(await lookups.readFile('lib/b.ts', 1, 5)).toBe(NOT_AVAILABLE)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('refuses a link inside the repository that points at .env', async () => {
    const [dir, outside] = await tempDirs()
    try {
      await writeFile(join(dir, '.env'), 'SECRET=1')
      await symlink(join(dir, '.env'), join(dir, 'config.ts'))
      const lookups = createLookups(linkGit(dir), [])
      expect(await lookups.readFile('config.ts', 1, 5)).toBe(NOT_AVAILABLE)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('filters a quoted secret path out of search hits', async () => {
    const git: Git = {
      ...fakeGit,
      grep: async () => ['"\\303\\274/credentials":1:token', 'src/a.ts:1:token'],
    }
    expect(await createLookups(git, []).search('token')).toBe('src/a.ts:1:token')
  })

  it('answers not available for a tracked file that is gone from disk', async () => {
    const [dir, outside] = await tempDirs()
    try {
      const git: Git = { ...fakeGit, root: dir, readFile: createGit(dir).readFile }
      const lookups = createLookups({ ...git, isTracked: async () => true }, [])
      expect(await lookups.readFile('gone.ts', 1, 5)).toBe(NOT_AVAILABLE)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('keeps the text within the budget counting the joining newline', () => {
    const bundle = buildBundle([ranked('a.ts', 10), ranked('b.ts', 10)], 210)
    expect(bundle.quizzed).toHaveLength(1)
    expect(bundle.text.length).toBeLessThanOrEqual(210)
  })
})

describe('ruling 9', () => {
  async function trackedRepo(): Promise<string> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'muellim-ctx-')))
    const sh = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    sh('init', '-q', '-b', 'main')
    await mkdir(join(dir, 'src'))
    await writeFile(join(dir, 'src/a.ts'), 'export const a = 1\n')
    await writeFile(join(dir, '.gitignore'), 'private.json\n')
    await writeFile(join(dir, 'private.json'), '{ "key": "hidden" }\n')
    await symlink('.git/config', join(dir, 'gitcfg.md'))
    await symlink('private.json', join(dir, 'priv.ts'))
    await symlink('src', join(dir, 'dirlink'))
    sh('add', '.gitignore', 'src/a.ts', 'gitcfg.md', 'priv.ts', 'dirlink')
    return dir
  }

  it('refuses a tracked link to .git/config and still reads a tracked file', async () => {
    const dir = await trackedRepo()
    try {
      const lookups = createLookups(createGit(dir), [])
      expect(await lookups.readFile('gitcfg.md', 1, 50)).toBe(NOT_AVAILABLE)
      expect(await lookups.readFile('src/a.ts', 1, 1)).toBe('1: export const a = 1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a tracked link to a gitignored file', async () => {
    const dir = await trackedRepo()
    try {
      const lookups = createLookups(createGit(dir), [])
      expect(await lookups.readFile('priv.ts', 1, 5)).toBe(NOT_AVAILABLE)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a tracked link to a folder', async () => {
    const dir = await trackedRepo()
    try {
      const lookups = createLookups(createGit(dir), [])
      expect(await lookups.readFile('dirlink', 1, 5)).toBe(NOT_AVAILABLE)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('ruling 10', () => {
  it('leaves out search hits under a folder that links outside the repository', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'muellim-ctx-')))
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'muellim-out-')))
    try {
      const sh = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
      sh('init', '-q', '-b', 'main')
      await mkdir(join(dir, 'src'))
      await mkdir(join(dir, 'lib'))
      await writeFile(join(dir, 'src/a.ts'), 'export const a = 1 // token\n')
      await writeFile(join(dir, 'lib/b.ts'), 'export const b = 1 // token\n')
      sh('add', 'src/a.ts', 'lib/b.ts')
      await writeFile(join(outside, 'b.ts'), 'OUTSIDE token\n')
      await rm(join(dir, 'lib'), { recursive: true, force: true })
      await symlink(outside, join(dir, 'lib'))
      const lookups = createLookups(createGit(dir), [])
      expect(await lookups.search('token')).toBe('src/a.ts:1:export const a = 1 // token')
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})

describe('rulings 12 and 13', () => {
  async function linkedRepo(): Promise<string> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'muellim-ctx-')))
    const sh = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    sh('init', '-q', '-b', 'main')
    await mkdir(join(dir, 'src'))
    await mkdir(join(dir, 'cfgdir'))
    await mkdir(join(dir, 'h2'))
    await mkdir(join(dir, 'hidden'))
    await writeFile(join(dir, 'src/a.ts'), 'export const a = 1 // token repositoryformatversion\n')
    await writeFile(join(dir, 'cfgdir/config'), 'x = 1\n')
    await writeFile(join(dir, 'h2/x.ts'), 'export const x = 1\n')
    await writeFile(join(dir, '.gitignore'), 'hidden/\n')
    await writeFile(join(dir, 'hidden/x.ts'), 'hidden token in ignored folder\n')
    sh('add', '.gitignore', 'src/a.ts', 'cfgdir/config', 'h2/x.ts')
    return dir
  }
  const ordinary = 'src/a.ts:1:export const a = 1 // token repositoryformatversion'

  it('leaves out search hits under a tracked folder swapped for a link to .git', async () => {
    const dir = await linkedRepo()
    try {
      await rm(join(dir, 'cfgdir'), { recursive: true, force: true })
      await symlink('.git', join(dir, 'cfgdir'))
      const lookups = createLookups(createGit(dir), [])
      expect(await lookups.search('repositoryformatversion')).toBe(ordinary)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('leaves out search hits under a tracked folder swapped for a link to an ignored folder', async () => {
    const dir = await linkedRepo()
    try {
      await rm(join(dir, 'h2'), { recursive: true, force: true })
      await symlink('hidden', join(dir, 'h2'))
      const lookups = createLookups(createGit(dir), [])
      expect(await lookups.search('token')).toBe(ordinary)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads and searches a tracked file under a folder whose name is stored decomposed', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'muellim-ctx-')))
    try {
      const sh = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
      sh('init', '-q', '-b', 'main')
      const folder = 'çö'.normalize('NFD')
      await mkdir(join(dir, folder))
      await writeFile(join(dir, folder, 'b.ts'), 'export const b = 1 // token\n')
      sh('add', '.')
      const name = sh('ls-files', '-z').split('\0')[0] ?? ''
      const lookups = createLookups(createGit(dir), [])
      expect(await lookups.readFile(name, 1, 1)).toBe('1: export const b = 1 // token')
      expect(await lookups.search('token')).toMatch(/b\.ts"?:1:export const b = 1 \/\/ token$/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('final review issue 1', () => {
  it.each([
    ['color.ui', 'always'],
    ['color.grep', 'always'],
  ])('keeps secret search hits out and counts words under %s=%s', async (key, value) => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'muellim-ctx-')))
    try {
      const sh = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
      sh('init', '-q', '-b', 'main')
      sh('config', key, value)
      await mkdir(join(dir, 'src'))
      await writeFile(join(dir, '.env'), 'API_KEY=SECRET_ENV_VALUE\n')
      await writeFile(join(dir, 'src/a.ts'), 'export const key = process.env.API_KEY\n')
      sh('add', '-f', '.env', 'src/a.ts')
      const git = createGit(dir)
      const lookups = createLookups(git, [])
      expect(await lookups.search('SECRET_ENV_VALUE')).toBe(NOT_AVAILABLE)
      expect(await lookups.search('API_KEY')).toBe(
        'src/a.ts:1:export const key = process.env.API_KEY',
      )
      expect(await git.countWord('API_KEY')).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('leaves out a search hit whose path is neither on disk nor tracked', async () => {
    const git: Git = {
      ...fakeGit,
      grep: async () => ['\u001b[35m.env\u001b[m\u001b[36m:1:token', 'src/a.ts:1:token'],
    }
    expect(await createLookups(git, []).search('token')).toBe('src/a.ts:1:token')
  })
})

describe('ruling 14', () => {
  it('reads no lines for a negative, reversed or non-finite range', async () => {
    const read = (from: number, to: number) =>
      createLookups(fakeGit, []).readFile('src/a.ts', from, to)
    expect(await read(1, -1)).toBe('')
    expect(await read(5, 2)).toBe('')
    expect(await read(1, Number.POSITIVE_INFINITY)).toBe('')
  })
})

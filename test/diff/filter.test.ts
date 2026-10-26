import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  filterChunks,
  globToRegExp,
  isSecretPath,
  loadIgnore,
  parseIgnore,
} from '../../src/diff/filter.js'
import type { Chunk } from '../../src/types.js'

const chunk = (file: string): Chunk => ({
  file,
  header: '@@ -1 +1 @@',
  lines: ['+x'],
  added: 1,
  removed: 0,
  lineKeys: ['k'],
})

describe('isSecretPath', () => {
  it.each([
    '.env',
    '.env.local',
    'config/.env.production',
    'certs/server.pem',
    'deploy/prod.key',
    '.ssh/id_ed25519',
    'keys/id_rsa.pub',
    '.npmrc',
    'aws/credentials',
    '.ENV',
    'certs/Server.PEM',
    '.ssh/ID_RSA',
    'aws/Credentials',
    '.envrc',
    '.env-local',
    '.env_production',
    '.ssh/id_ed25519_sk',
    '.ssh/id_ecdsa_sk',
    '.git-credentials',
    '.pgpass',
    'keys/server.ppk',
    'AuthKey_ABC.p8',
    'secring.gpg',
    'prod.env',
    'config/app.env',
    'terraform.tfvars',
    'envs/prod.auto.tfvars',
    'terraform.tfvars.json',
    'terraform.tfstate',
    'infra/terraform.tfstate.backup',
    '.htpasswd',
    'conf/.htpasswd',
  ])('treats %s as a secret', (path) => {
    expect(isSecretPath(path)).toBe(true)
  })

  it.each([
    'src/env.ts',
    'src/id_utils.ts',
    'docs/keys.md',
    'src/environment.ts',
    'infra/main.tf',
    'src/dotenv.ts',
  ])(
    'treats %s as ordinary code',
    (path) => {
      expect(isSecretPath(path)).toBe(false)
    },
  )
})

describe('globToRegExp', () => {
  it('matches a bare name anywhere and an anchored path only at the root', () => {
    expect(globToRegExp('generated').test('src/generated/a.ts')).toBe(true)
    expect(globToRegExp('/generated').test('src/generated/a.ts')).toBe(false)
    expect(globToRegExp('/generated').test('generated/a.ts')).toBe(true)
  })

  it('supports *, ** and directory-only patterns', () => {
    expect(globToRegExp('*.snap').test('test/__snapshots__/a.test.ts.snap')).toBe(true)
    expect(globToRegExp('src/**/fixtures').test('src/a/b/fixtures/x.json')).toBe(true)
    expect(globToRegExp('vendor/').test('vendor/lib.js')).toBe(true)
    expect(globToRegExp('vendor/').test('vendor')).toBe(false)
  })

  it('lets **/ stand for zero or more whole folders only', () => {
    expect(globToRegExp('src/**/fixtures').test('src/fixtures/x')).toBe(true)
    expect(globToRegExp('src/**/fixtures').test('src/a/b/fixtures/x')).toBe(true)
    expect(globToRegExp('src/**/fixtures').test('src/myfixtures/x')).toBe(false)
    expect(globToRegExp('**/foo').test('src/foo')).toBe(true)
    expect(globToRegExp('**/foo').test('src/barfoo')).toBe(false)
  })
})

describe('filterChunks', () => {
  it('drops secret files and ignored paths, keeps the rest', () => {
    const ignore = parseIgnore('# generated code\n*.gen.ts\n\nvendor/\n')
    const kept = filterChunks(
      [chunk('src/a.ts'), chunk('.env'), chunk('src/b.gen.ts'), chunk('vendor/x.js')],
      ignore,
    )
    expect(kept.map((c) => c.file)).toEqual(['src/a.ts'])
  })

  it("always drops Muellim's own state files", () => {
    const kept = filterChunks([chunk('.muellim/transcript.md'), chunk('src/.muellim.ts')], [])
    expect(kept.map((c) => c.file)).toEqual(['src/.muellim.ts'])
  })
})

describe('loadIgnore', () => {
  it('reads .muellimignore and returns no patterns when it is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'muellim-ignore-'))
    try {
      expect(await loadIgnore(dir)).toEqual([])
      await writeFile(join(dir, '.muellimignore'), 'dist/\n')
      const patterns = await loadIgnore(dir)
      expect(patterns.some((p) => p.test('dist/cli.js'))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('throws when .muellimignore exists but cannot be read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'muellim-ignore-'))
    try {
      await mkdir(join(dir, '.muellimignore'))
      await expect(loadIgnore(dir)).rejects.toMatchObject({ code: 'EISDIR' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

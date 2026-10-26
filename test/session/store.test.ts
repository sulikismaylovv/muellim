import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadSession, markPassed, savePrResult, saveSession } from '../../src/session/store.js'
import type { Session } from '../../src/types.js'

const session: Session = {
  version: 1,
  startedAt: '2026-10-26T10:00:00.000Z',
  baseCommit: 'abc1234',
  brief: { goal: 'add refresh tokens', focus: ['auth'] },
  passed: ['k1'],
}

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'muellim-s-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('session store', () => {
  it('returns null when there is no session yet', async () => {
    expect(await loadSession(await tempRoot())).toBeNull()
  })

  it('rejects when session.json holds invalid JSON', async () => {
    const root = await tempRoot()
    await mkdir(join(root, '.muellim'))
    await writeFile(join(root, '.muellim', 'session.json'), '{ not json')
    await expect(loadSession(root)).rejects.toThrow(SyntaxError)
  })

  it('saves and loads a session', async () => {
    const root = await tempRoot()
    await saveSession(root, session)
    expect(await loadSession(root)).toEqual(session)
  })

  it('adds passed keys without duplicates and persists them', async () => {
    const root = await tempRoot()
    const updated = await markPassed(root, session, ['k1', 'k2', 'k2'])
    expect(updated.passed).toEqual(['k1', 'k2'])
    expect((await loadSession(root))?.passed).toEqual(['k1', 'k2'])
  })

  it('writes the pull request result where spec 2 will read it', async () => {
    const root = await tempRoot()
    const path = await savePrResult(root, {
      pullRequest: 42,
      headSha: 'def5678',
      score: { firstTry: 2, onRetry: 1, taught: 0, total: 3 },
      topics: ['token refresh'],
      notQuizzedChunks: 0,
      createdAt: '2026-10-26T11:00:00.000Z',
    })
    expect(path).toBe('.muellim/pr-42.json')
    expect(JSON.parse(await readFile(join(root, path), 'utf8')).headSha).toBe('def5678')
  })
})

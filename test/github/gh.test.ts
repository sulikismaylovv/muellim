import { describe, expect, it } from 'vitest'
import { createGh, type Exec } from '../../src/github/gh.js'

function failing(error: Record<string, unknown>): Exec {
  return async () => {
    throw Object.assign(new Error('Command failed'), error)
  }
}

describe('createGh', () => {
  it('asks gh for the diff and the head commit of a pull request', async () => {
    const calls: string[][] = []
    const exec: Exec = async (_file, args) => {
      calls.push(args)
      return { stdout: args[1] === 'diff' ? 'diff --git a/x b/x\n' : 'abc123\n' }
    }
    const gh = createGh('/repo', exec)
    expect(await gh.prDiff(42)).toBe('diff --git a/x b/x\n')
    expect(await gh.prHead(42)).toBe('abc123')
    expect(calls).toEqual([
      ['pr', 'diff', '42', '--color', 'never'],
      ['pr', 'view', '42', '--json', 'headRefOid', '--jq', '.headRefOid'],
    ])
  })

  it('maps a missing sign-in to gh-auth', async () => {
    const gh = createGh(
      '/repo',
      failing({ stderr: 'To get started with GitHub CLI, please run:  gh auth login' }),
    )
    await expect(gh.prDiff(1)).rejects.toMatchObject({ code: 'gh-auth' })
  })

  it('maps a missing gh binary to gh-auth', async () => {
    const gh = createGh('/repo', failing({ code: 'ENOENT' }))
    await expect(gh.prHead(1)).rejects.toMatchObject({ code: 'gh-auth' })
  })

  it('maps any other failure to gh-failed', async () => {
    const gh = createGh('/repo', failing({ stderr: 'no pull requests found for 999' }))
    await expect(gh.prDiff(999)).rejects.toMatchObject({ code: 'gh-failed' })
  })
})

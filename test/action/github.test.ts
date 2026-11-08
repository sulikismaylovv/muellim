import { describe, expect, it } from 'vitest'
import { createGithubApi } from '../../src/action/github.js'

const token = 'ghs_SECRET_TOKEN'
const options = { token, repository: 'o/r', apiUrl: 'https://api.github.test' }

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const stub = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return { calls, stub }
}

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return (error as Error).message
  }
  return 'no error'
}

describe('createGithubApi', () => {
  it('reads the head, author and labels of a pull request', async () => {
    const { calls, stub } = fakeFetch(200, {
      number: 42,
      head: { sha: 'abc' },
      user: { login: 'ada' },
      labels: [{ name: 'muellim-skip' }],
    })
    const pull = await createGithubApi({ ...options, fetch: stub }).getPull(42)
    expect(pull).toEqual({ number: 42, headSha: 'abc', author: 'ada', labels: ['muellim-skip'] })
    expect(calls[0]?.url).toBe('https://api.github.test/repos/o/r/pulls/42')
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe(`Bearer ${token}`)
  })

  it('posts the status under the muellim context, cut to 140 characters', async () => {
    const { calls, stub } = fakeFetch(201, {})
    await createGithubApi({ ...options, fetch: stub }).setStatus('abc', {
      state: 'success',
      description: 'x'.repeat(200),
    })
    expect(calls[0]?.url).toBe('https://api.github.test/repos/o/r/statuses/abc')
    expect(calls[0]?.init.method).toBe('POST')
    const sent = JSON.parse(String(calls[0]?.init.body))
    expect(sent.context).toBe('muellim')
    expect(sent.state).toBe('success')
    expect(sent.description).toHaveLength(140)
  })

  it('reports a failed call without the token', async () => {
    const { stub } = fakeFetch(403, { message: 'nope' })
    const message = await messageOf(
      createGithubApi({ ...options, fetch: stub }).setStatus('abc', {
        state: 'pending',
        description: 'x',
      }),
    )
    expect(message).toContain('403')
    expect(message).not.toContain(token)
  })

  it('reports an unreachable GitHub without the token', async () => {
    const stub = (async () => {
      throw new Error(`failed with ${token}`)
    }) as typeof fetch
    const message = await messageOf(createGithubApi({ ...options, fetch: stub }).getPull(1))
    expect(message).toContain('could not reach')
    expect(message).not.toContain(token)
  })
})

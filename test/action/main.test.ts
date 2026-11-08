import { describe, expect, it } from 'vitest'
import type { Pull, Status } from '../../src/action/decide.js'
import type { GithubApi } from '../../src/action/github.js'
import { parseEvent, runAction, runFromEnv } from '../../src/action/main.js'
import { writeMarker } from '../../src/github/marker.js'

const head = 'abc1234def5678abc1234def5678abc1234def56'
const score = { firstTry: 1, onRetry: 0, taught: 0, total: 1 }
const pull: Pull = { number: 42, headSha: head, author: 'ada', labels: [] }

function fakeApi(current: Pull = pull) {
  const statuses: Array<[string, Status]> = []
  const api: GithubApi = {
    getPull: async () => current,
    setStatus: async (sha, status) => {
      statuses.push([sha, status])
    },
  }
  return { api, statuses }
}

const comment = (body: string, action = 'created', onPull = true) => ({
  action,
  issue: { number: 42, ...(onPull ? { pull_request: {} } : {}) },
  comment: { body, user: { login: 'ada' } },
})

describe('parseEvent', () => {
  it.each(['opened', 'reopened', 'synchronize'])('reads a pull request %s', (action) => {
    expect(parseEvent('pull_request_target', { action, number: 42 })).toEqual({
      pullRequest: 42,
      event: { kind: 'pull' },
    })
  })

  it('reads label changes and ignores other pull request actions', () => {
    const labeled = { action: 'labeled', number: 42, label: { name: 'bug' } }
    expect(parseEvent('pull_request_target', labeled)?.event).toEqual({
      kind: 'label',
      action: 'labeled',
      label: 'bug',
    })
    expect(parseEvent('pull_request_target', { action: 'closed', number: 42 })).toBeNull()
  })

  it('ignores an edited comment and a comment on an issue', () => {
    expect(parseEvent('issue_comment', comment('x', 'edited'))).toBeNull()
    expect(parseEvent('issue_comment', comment('x', 'created', false))).toBeNull()
  })

  it('ignores other events and malformed payloads', () => {
    expect(parseEvent('push', {})).toBeNull()
    expect(parseEvent('issue_comment', { action: 'created' })).toBeNull()
  })
})

describe('runAction', () => {
  it('sets pending on the current head for a pull request event', async () => {
    const { api, statuses } = fakeApi()
    await runAction('pull_request_target', { action: 'synchronize', number: 42 }, api)
    expect(statuses).toEqual([[head, { state: 'pending', description: 'Run: muellim pr 42' }]])
  })

  it('sets success for a pass comment from the author', async () => {
    const { api, statuses } = fakeApi()
    await runAction('issue_comment', comment(writeMarker(head, score)), api)
    expect(statuses[0]?.[1].state).toBe('success')
  })

  it('does not set a status for a pass on an older commit', async () => {
    const { api, statuses } = fakeApi({ ...pull, headSha: 'def5678' })
    await runAction('issue_comment', comment(writeMarker(head, score)), api)
    expect(statuses).toEqual([])
  })
})

describe('runFromEnv', () => {
  it('fails with a plain message when the token is missing', async () => {
    await expect(runFromEnv({}, () => '{}')).rejects.toThrow('token')
  })

  it('passes the token, repository and default API URL to the client', async () => {
    let seen: unknown
    const { api } = fakeApi()
    await runFromEnv(
      {
        INPUT_TOKEN: 't',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: '/event.json',
      },
      () => '{}',
      (options) => {
        seen = options
        return api
      },
    )
    expect(seen).toEqual({ token: 't', repository: 'o/r', apiUrl: 'https://api.github.com' })
  })
})

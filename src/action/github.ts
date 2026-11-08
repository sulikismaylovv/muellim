import { z } from 'zod'
import { en } from '../strings/en.js'
import type { Pull, Status } from './decide.js'

export const STATUS_CONTEXT = 'muellim'
const DESCRIPTION_LIMIT = 140

export interface GithubApi {
  getPull(pullRequest: number): Promise<Pull>
  setStatus(sha: string, status: Status): Promise<void>
}

export interface GithubOptions {
  token: string
  repository: string
  apiUrl: string
  fetch?: typeof fetch
}

const pullSchema = z.object({
  number: z.number(),
  head: z.object({ sha: z.string() }),
  user: z.object({ login: z.string() }),
  labels: z.array(z.object({ name: z.string() })),
})

/** A small client for the two GitHub REST calls the action needs. */
export function createGithubApi(options: GithubOptions): GithubApi {
  const call = options.fetch ?? fetch
  const request = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    let response: Response
    try {
      response = await call(`${options.apiUrl}/repos/${options.repository}/${path}`, {
        method,
        headers: {
          authorization: `Bearer ${options.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new Error(en.action.apiUnreachable(method, path))
    }
    if (!response.ok) throw new Error(en.action.apiFailed(response.status, method, path))
    return response.json()
  }
  return {
    async getPull(pullRequest) {
      const pull = pullSchema.parse(await request('GET', `pulls/${pullRequest}`))
      return {
        number: pull.number,
        headSha: pull.head.sha,
        author: pull.user.login,
        labels: pull.labels.map((label) => label.name),
      }
    },
    async setStatus(sha, status) {
      await request('POST', `statuses/${sha}`, {
        state: status.state,
        description: status.description.slice(0, DESCRIPTION_LIMIT),
        context: STATUS_CONTEXT,
      })
    },
  }
}

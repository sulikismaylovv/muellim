import { z } from 'zod'
import { en } from '../strings/en.js'
import { type ActionEvent, decide } from './decide.js'
import { createGithubApi, type GithubApi } from './github.js'

const pullPayload = z.object({
  action: z.string(),
  number: z.number().int().positive(),
  label: z.object({ name: z.string() }).optional(),
})

const commentPayload = z.object({
  action: z.string(),
  issue: z.object({
    number: z.number().int().positive(),
    pull_request: z.unknown().optional(),
  }),
  comment: z.object({ body: z.string(), user: z.object({ login: z.string() }) }),
})

export interface ParsedEvent {
  pullRequest: number
  event: ActionEvent
}

/** Turns GitHub's event into one the rules understand. `null` means nothing to do. */
export function parseEvent(name: string, payload: unknown): ParsedEvent | null {
  if (name === 'pull_request_target') {
    const parsed = pullPayload.safeParse(payload)
    if (!parsed.success) return null
    const { action, number, label } = parsed.data
    if (action === 'opened' || action === 'reopened' || action === 'synchronize') {
      return { pullRequest: number, event: { kind: 'pull' } }
    }
    if ((action === 'labeled' || action === 'unlabeled') && label) {
      return { pullRequest: number, event: { kind: 'label', action, label: label.name } }
    }
    return null
  }
  if (name === 'issue_comment') {
    const parsed = commentPayload.safeParse(payload)
    if (!parsed.success) return null
    const { action, issue, comment } = parsed.data
    // Only new comments count, and only those on pull requests.
    if (action !== 'created' || !issue.pull_request) return null
    return {
      pullRequest: issue.number,
      event: { kind: 'comment', author: comment.user.login, body: comment.body },
    }
  }
  return null
}

export async function runAction(name: string, payload: unknown, api: GithubApi): Promise<void> {
  const parsed = parseEvent(name, payload)
  if (!parsed) return
  // Always read the pull request fresh: the head may have moved since the event was sent.
  const pull = await api.getPull(parsed.pullRequest)
  const status = decide(parsed.event, pull)
  if (status) await api.setStatus(pull.headSha, status)
}

/** Reads the environment GitHub gives an action and runs it once. */
export async function runFromEnv(
  env: NodeJS.ProcessEnv,
  readText: (path: string) => string,
  makeApi: typeof createGithubApi = createGithubApi,
): Promise<void> {
  const token = env.INPUT_TOKEN
  const repository = env.GITHUB_REPOSITORY
  const name = env.GITHUB_EVENT_NAME
  const path = env.GITHUB_EVENT_PATH
  if (!token || !repository || !name || !path) throw new Error(en.action.missingEnv)
  const apiUrl = env.GITHUB_API_URL || 'https://api.github.com'
  await runAction(name, JSON.parse(readText(path)), makeApi({ token, repository, apiUrl }))
}

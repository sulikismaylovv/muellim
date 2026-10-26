import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PrPassResult, Session } from '../types.js'

export const STATE_DIR = '.muellim'

async function writeJson(root: string, name: string, value: unknown): Promise<string> {
  await mkdir(join(root, STATE_DIR), { recursive: true })
  const relative = `${STATE_DIR}/${name}`
  await writeFile(join(root, relative), `${JSON.stringify(value, null, 2)}\n`)
  return relative
}

/** Reads `.muellim/session.json`. A missing file means no session; other read or parse errors throw. */
export async function loadSession(root: string): Promise<Session | null> {
  try {
    return JSON.parse(await readFile(join(root, STATE_DIR, 'session.json'), 'utf8')) as Session
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function saveSession(root: string, session: Session): Promise<void> {
  await writeJson(root, 'session.json', session)
}

/** Adds line keys to the session's passed set, without duplicates, and saves it. */
export async function markPassed(root: string, session: Session, keys: string[]): Promise<Session> {
  const updated: Session = { ...session, passed: [...new Set([...session.passed, ...keys])] }
  await saveSession(root, updated)
  return updated
}

/** Writes `.muellim/pr-<number>.json` and returns that repo-relative path. */
export function savePrResult(root: string, result: PrPassResult): Promise<string> {
  return writeJson(root, `pr-${result.pullRequest}.json`, result)
}

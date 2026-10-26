import { saveSession } from '../session/store.js'
import { en } from '../strings/en.js'
import type { Session } from '../types.js'
import type { AppDeps } from './pipeline.js'

export interface StartOptions {
  goal?: string
  /** Comma-separated areas, as typed on the command line. */
  focus?: string
}

/** Records the base commit and the brief. A new start replaces the previous session. */
export async function startCommand(
  deps: Pick<AppDeps, 'git' | 'asker' | 'now'>,
  options: StartOptions,
): Promise<Session> {
  const goal = options.goal ?? (await deps.asker.askText(en.start.goalPrompt, true))
  const focusText = options.focus ?? (await deps.asker.askText(en.start.focusPrompt, false))
  const session: Session = {
    version: 1,
    startedAt: deps.now().toISOString(),
    baseCommit: await deps.git.baseCommit(),
    brief: {
      goal: goal.trim(),
      focus: focusText
        .split(',')
        .map((area) => area.trim())
        .filter(Boolean),
    },
    passed: [],
  }
  await saveSession(deps.git.root, session)
  deps.asker.show(en.start.saved(session.baseCommit))
  return session
}

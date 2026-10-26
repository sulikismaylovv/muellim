import { MuellimError } from '../errors.js'
import { loadSession, markPassed } from '../session/store.js'
import { en } from '../strings/en.js'
import type { RunResult } from '../types.js'
import { type AppDeps, quizChanges } from './pipeline.js'

/** Quizzes the change since `start`, minus everything an earlier run already covered. */
export async function checkCommand(deps: AppDeps): Promise<RunResult> {
  const session = await loadSession(deps.git.root)
  if (!session) throw new MuellimError('no-session')
  const diff = await deps.git.diffSince(session.baseCommit)
  const result = await quizChanges('check', diff, session.passed, session.brief, deps)
  if (result.status === 'nothing-to-check') {
    deps.asker.show(en.check.nothing)
    return result
  }
  await markPassed(deps.git.root, session, [...result.quizzed, ...result.notQuizzed])
  deps.asker.show(en.check.passed(result.score))
  if (result.notQuizzedChunks > 0) deps.asker.show(en.check.notQuizzed(result.notQuizzedChunks))
  return result
}

import type { Gh } from '../github/gh.js'
import { loadSession, markPassed, savePrResult } from '../session/store.js'
import { en } from '../strings/en.js'
import type { PrPassResult } from '../types.js'
import { type AppDeps, quizChanges } from './pipeline.js'

/**
 * Quizzes whatever part of the pull request no earlier check covered, then writes
 * `.muellim/pr-<number>.json` for spec 2 to post. Nothing left to quiz counts as a pass.
 */
export async function prCommand(
  deps: AppDeps & { gh: Gh },
  pullRequest: number,
): Promise<PrPassResult> {
  deps.asker.show(en.pr.fetching(pullRequest))
  const [diff, headSha] = await Promise.all([
    deps.gh.prDiff(pullRequest),
    deps.gh.prHead(pullRequest),
  ])
  const session = await loadSession(deps.git.root)
  const result = await quizChanges(
    'pr',
    diff,
    session?.passed ?? [],
    session?.brief ?? { goal: '', focus: [] },
    deps,
  )
  if (result.status === 'nothing-to-check') {
    deps.asker.show(en.check.nothing)
  } else {
    if (session) await markPassed(deps.git.root, session, [...result.quizzed, ...result.notQuizzed])
    deps.asker.show(en.check.passed(result.score))
    if (result.notQuizzedChunks > 0) deps.asker.show(en.check.notQuizzed(result.notQuizzedChunks))
  }
  const pass: PrPassResult = {
    pullRequest,
    headSha,
    score: result.score,
    topics: result.results.map((r) => r.question.topic),
    notQuizzedChunks: result.notQuizzedChunks,
    createdAt: deps.now().toISOString(),
  }
  const path = await savePrResult(deps.git.root, pass)
  deps.asker.show(en.pr.saved(pullRequest, path))
  return pass
}

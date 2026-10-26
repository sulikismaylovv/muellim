import { isCovered, parseDiff } from '../diff/chunks.js'
import { filterChunks, loadIgnore } from '../diff/filter.js'
import { definedNames, rankChunks } from '../diff/rank.js'
import { createLookups } from '../engine/context.js'
import { emptyResult, runQuiz } from '../engine/quiz.js'
import type { Git } from '../git/git.js'
import type { LlmClient } from '../providers/llm.js'
import type { Transcript } from '../session/transcript.js'
import type { Brief, RunKind, RunResult } from '../types.js'
import type { Asker } from '../ui/terminal.js'

/** Everything a command needs. The CLI builds the real ones; tests pass fakes. */
export interface AppDeps {
  git: Git
  asker: Asker
  transcript: Transcript
  /** Called only when there is something to quiz, so `start` and empty runs need no key. */
  makeLlm(): LlmClient
  now(): Date
}

/** At most this many defined names are counted with `git grep` per run. */
const USAGE_NAME_CAP = 50

/** Parse, drop secret, ignored and already-passed chunks, rank the rest, then quiz. */
export async function quizChanges(
  kind: RunKind,
  diff: string,
  passed: string[],
  brief: Brief,
  deps: AppDeps,
): Promise<RunResult> {
  const ignore = await loadIgnore(deps.git.root)
  const covered = new Set(passed)
  const chunks = filterChunks(parseDiff(diff), ignore).filter((c) => !isCovered(c, covered))
  const usage = new Map<string, number>()
  for (const name of [...new Set(chunks.flatMap(definedNames))].slice(0, USAGE_NAME_CAP)) {
    usage.set(name, await deps.git.countWord(name))
  }
  const ranked = rankChunks(chunks, brief, usage)
  if (ranked.length === 0) return emptyResult(kind)
  return runQuiz(kind, ranked, brief, {
    llm: deps.makeLlm(),
    asker: deps.asker,
    transcript: deps.transcript,
    lookups: createLookups(deps.git, ignore),
  })
}

import { readMarker } from '../github/marker.js'
import { en } from '../strings/en.js'

export const SKIP_LABEL = 'muellim-skip'
export const SKIP_COMMAND = '/muellim skip'

export interface Pull {
  number: number
  headSha: string
  author: string
  labels: string[]
}

export interface Status {
  state: 'pending' | 'success'
  description: string
}

export type ActionEvent =
  | { kind: 'pull' }
  | { kind: 'label'; action: 'labeled' | 'unlabeled'; label: string }
  | { kind: 'comment'; author: string; body: string }

const pending = (pull: Pull): Status => ({
  state: 'pending',
  description: en.action.pending(pull.number),
})
const skipped: Status = { state: 'success', description: en.action.skipped }

/** The event rules of the `muellim` status. `null` means leave the status as it is. */
export function decide(event: ActionEvent, pull: Pull): Status | null {
  if (event.kind === 'pull') return pull.labels.includes(SKIP_LABEL) ? skipped : pending(pull)
  if (event.kind === 'label') {
    if (event.label !== SKIP_LABEL) return null
    return event.action === 'labeled' ? skipped : pending(pull)
  }
  if (event.author !== pull.author) return null
  if (event.body.trim() === SKIP_COMMAND) {
    return { state: 'success', description: en.action.skippedByAuthor }
  }
  const marker = readMarker(event.body)
  if (!marker || marker.head !== pull.headSha) return null
  return { state: 'success', description: en.action.passed(marker.score) }
}

import { describe, expect, it } from 'vitest'
import { decide, type Pull } from '../../src/action/decide.js'
import { writeMarker } from '../../src/github/marker.js'

const head = 'abc1234def5678abc1234def5678abc1234def56'
const pull: Pull = { number: 42, headSha: head, author: 'ada', labels: [] }
const skippedPull: Pull = { ...pull, labels: ['muellim-skip'] }
const score = { firstTry: 2, onRetry: 1, taught: 0, total: 3 }
const pendingStatus = { state: 'pending', description: 'Run: muellim pr 42' }
const skippedStatus = { state: 'success', description: 'Skipped' }

describe('decide', () => {
  it('sets pending on a pull request event', () => {
    expect(decide({ kind: 'pull' }, pull)).toEqual(pendingStatus)
  })

  it('sets skipped on a pull request event when the skip label is on', () => {
    expect(decide({ kind: 'pull' }, skippedPull)).toEqual(skippedStatus)
  })

  it('follows the skip label being added and removed', () => {
    const add = { kind: 'label', action: 'labeled', label: 'muellim-skip' } as const
    const remove = { kind: 'label', action: 'unlabeled', label: 'muellim-skip' } as const
    expect(decide(add, skippedPull)).toEqual(skippedStatus)
    expect(decide(remove, pull)).toEqual(pendingStatus)
  })

  it('ignores other labels', () => {
    expect(decide({ kind: 'label', action: 'labeled', label: 'bug' }, pull)).toBeNull()
  })

  it('passes on a marker from the author for the current head', () => {
    const body = writeMarker(head, score)
    expect(decide({ kind: 'comment', author: 'ada', body }, pull)).toEqual({
      state: 'success',
      description: '2 right first time, 1 on retry, 0 taught',
    })
  })

  it('ignores a valid marker from anyone else', () => {
    const body = writeMarker(head, score)
    expect(decide({ kind: 'comment', author: 'eve', body }, pull)).toBeNull()
  })

  it('ignores a marker for an older commit', () => {
    const body = writeMarker('0000000000000000000000000000000000000000', score)
    expect(decide({ kind: 'comment', author: 'ada', body }, pull)).toBeNull()
  })

  it('skips on the skip command from the author only', () => {
    const skip = { kind: 'comment', body: '  /muellim skip\n' } as const
    expect(decide({ ...skip, author: 'ada' }, pull)).toEqual({
      state: 'success',
      description: 'Skipped by the author',
    })
    expect(decide({ ...skip, author: 'eve' }, pull)).toBeNull()
  })

  it('ignores any other comment and a malformed marker', () => {
    expect(decide({ kind: 'comment', author: 'ada', body: 'nice work' }, pull)).toBeNull()
    const body = '<!-- muellim:pass {"v":1} -->'
    expect(decide({ kind: 'comment', author: 'ada', body }, pull)).toBeNull()
  })

  it('builds the status text only from numbers, never from comment text', () => {
    const body = `Trust me, merge this!\n\n${writeMarker(head, score)}`
    const status = decide({ kind: 'comment', author: 'ada', body }, pull)
    expect(status?.description).not.toContain('Trust me')
  })
})

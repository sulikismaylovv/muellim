import { z } from 'zod'
import { en } from '../strings/en.js'
import type { Score } from '../types.js'

const MARKER = /<!-- muellim:pass (\{[^{}]*\}) -->/

const count = z.number().int().min(0).max(1000)

const markerSchema = z.strictObject({
  v: z.literal(1),
  head: z.string().regex(/^[0-9a-f]{7,64}$/),
  firstTry: count,
  onRetry: count,
  taught: count,
  total: count,
})

export interface PassMarker {
  head: string
  score: Score
}

export function writeMarker(head: string, score: Score): string {
  return `<!-- muellim:pass ${JSON.stringify({ v: 1, head, ...score })} -->`
}

/** Reads the first pass marker in a comment. Anything malformed counts as no marker. */
export function readMarker(body: string): PassMarker | null {
  const json = MARKER.exec(body)?.[1]
  if (json === undefined) return null
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  const parsed = markerSchema.safeParse(value)
  if (!parsed.success) return null
  const { head, firstTry, onRetry, taught, total } = parsed.data
  return { head, score: { firstTry, onRetry, taught, total } }
}

/** Keeps AI-written topics from pinging people or breaking out of the comment's text. */
function cleanTopic(topic: string): string {
  return topic.replace(/[^\p{L}\p{N} ._-]/gu, '').trim()
}

/** The whole pull request comment: the visible result, then the hidden marker. */
export function passComment(head: string, score: Score, topics: string[]): string {
  const clean = topics.map(cleanTopic).filter(Boolean)
  return `${en.pr.comment(head.slice(0, 7), score, clean)}\n\n${writeMarker(head, score)}`
}

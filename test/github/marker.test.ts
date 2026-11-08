import { describe, expect, it } from 'vitest'
import { passComment, readMarker, writeMarker } from '../../src/github/marker.js'

const head = 'abc1234def5678abc1234def5678abc1234def56'
const score = { firstTry: 2, onRetry: 1, taught: 0, total: 3 }

describe('pass marker', () => {
  it('reads back what it wrote, also inside a longer comment', () => {
    expect(readMarker(writeMarker(head, score))).toEqual({ head, score })
    expect(readMarker(`Looks good.\n\n${writeMarker(head, score)}\n`)).toEqual({ head, score })
  })

  it.each([
    'no marker here',
    '<!-- muellim:pass {not json} -->',
    '<!-- muellim:pass {"v":2,"head":"abc1234","firstTry":0,"onRetry":0,"taught":0,"total":0} -->',
    '<!-- muellim:pass {"v":1,"head":"NOT-A-SHA","firstTry":0,"onRetry":0,"taught":0,"total":0} -->',
    '<!-- muellim:pass {"v":1,"head":"abc1234","firstTry":-1,"onRetry":0,"taught":0,"total":0} -->',
    '<!-- muellim:pass {"v":1,"head":"abc1234","firstTry":1.5,"onRetry":0,"taught":0,"total":0} -->',
    '<!-- muellim:pass {"v":1,"head":"abc1234","firstTry":0,"onRetry":0,"taught":0,"total":0,"note":"hi"} -->',
  ])('treats %s as no marker', (body) => {
    expect(readMarker(body)).toBeNull()
  })
})

describe('passComment', () => {
  it('shows the score and topics, and carries the marker', () => {
    const body = passComment(head, score, ['token refresh', 'retry flag'])
    expect(body).toContain('abc1234')
    expect(body).toContain('2 right first time')
    expect(body).toContain('token refresh, retry flag')
    expect(readMarker(body)).toEqual({ head, score })
  })

  it('removes characters from topics that could ping people or fake a marker', () => {
    const body = passComment(head, score, [
      '@everyone look',
      'x --> <!-- muellim:pass {} -->',
      '```',
    ])
    expect(body).not.toContain('@')
    expect(body.match(/<!--/g)).toHaveLength(1)
    expect(body).not.toContain('```')
    expect(readMarker(body)).toEqual({ head, score })
  })

  it('keeps topics inside a code span so GitHub does not autolink them', () => {
    const body = passComment(head, score, ['www.evil.example', 'GH-123', 'deadbeefcafe'])
    expect(body).toContain('Topics: `www.evil.example, GH-123, deadbeefcafe`.')
    expect(readMarker(body)).toEqual({ head, score })
  })

  it('still reads the marker when there are no topics', () => {
    expect(readMarker(passComment(head, score, []))).toEqual({ head, score })
  })
})

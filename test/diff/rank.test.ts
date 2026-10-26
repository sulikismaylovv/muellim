import { describe, expect, it } from 'vitest'
import { definedNames, kindWeight, rankChunks } from '../../src/diff/rank.js'
import type { Brief, Chunk } from '../../src/types.js'

const chunk = (file: string, lines: string[]): Chunk => ({
  file,
  header: '@@ -1 +1 @@',
  lines,
  added: lines.filter((l) => l.startsWith('+')).length,
  removed: lines.filter((l) => l.startsWith('-')).length,
  lineKeys: lines.map((_, i) => `${file}-${i}`),
})

const noBrief: Brief = { goal: '', focus: [] }

describe('kindWeight', () => {
  it('weights source above config, tests, docs and lockfiles', () => {
    expect(kindWeight('src/a.ts')).toBe(1)
    expect(kindWeight('tsconfig.json')).toBe(0.6)
    expect(kindWeight('test/a.test.ts')).toBe(0.5)
    expect(kindWeight('README.md')).toBe(0.2)
    expect(kindWeight('package-lock.json')).toBe(0.05)
  })
})

describe('definedNames', () => {
  it('finds names defined on added lines only', () => {
    const c = chunk('src/a.ts', [
      '+export function refresh(t) {',
      '-const old = 1',
      '+class Session {}',
    ])
    expect(definedNames(c)).toEqual(['refresh', 'Session'])
  })
})

describe('rankChunks', () => {
  it('puts a widely used source change above a bigger docs change', () => {
    const docs = chunk(
      'README.md',
      Array.from({ length: 40 }, (_, i) => `+line ${i}`),
    )
    const code = chunk('src/auth.ts', ['+export function refresh(t) {', '+  return t', '+}'])
    const ranked = rankChunks([docs, code], noBrief, new Map([['refresh', 30]]))
    expect(ranked.map((c) => c.file)).toEqual(['src/auth.ts', 'README.md'])
  })

  it('doubles chunks the brief names and never drops the others', () => {
    const a = chunk('src/billing.ts', ['+const total = 1'])
    const b = chunk('src/auth.ts', ['+const token = 1'])
    const ranked = rankChunks([a, b], { goal: 'x', focus: ['Auth'] }, new Map())
    expect(ranked.map((c) => [c.file, c.briefMatch])).toEqual([
      ['src/auth.ts', true],
      ['src/billing.ts', false],
    ])
    expect(ranked[0]?.score).toBeCloseTo((ranked[1]?.score ?? 0) * 2)
  })

  it('keeps the original order for equal scores', () => {
    const a = chunk('src/a.ts', ['+x'])
    const b = chunk('src/b.ts', ['+y'])
    expect(rankChunks([a, b], noBrief, new Map()).map((c) => c.file)).toEqual([
      'src/a.ts',
      'src/b.ts',
    ])
  })
})

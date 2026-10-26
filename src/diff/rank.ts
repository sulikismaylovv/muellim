import type { Brief, Chunk, RankedChunk } from '../types.js'

/** File kinds that carry less risk than ordinary source code, checked in order. */
const KIND_WEIGHTS: Array<[RegExp, number]> = [
  [
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|Gemfile\.lock)$/,
    0.05,
  ],
  [/\.(md|mdx|txt|rst)$/, 0.2],
  [/(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/, 0.5],
  [/\.(json|ya?ml|toml|ini|cfg)$/, 0.6],
]

const DEFINITION =
  /\b(?:function|class|interface|type|const|let|var|def|fn|func|struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g

export function kindWeight(path: string): number {
  for (const [pattern, weight] of KIND_WEIGHTS) {
    if (pattern.test(path)) return weight
  }
  return 1
}

/** Names the chunk defines or redefines on its added lines. */
export function definedNames(chunk: Chunk): string[] {
  const names = new Set<string>()
  for (const line of chunk.lines) {
    if (!line.startsWith('+')) continue
    for (const match of line.matchAll(DEFINITION)) {
      if (match[1]) names.add(match[1])
    }
  }
  return [...names]
}

export function briefMatches(chunk: Chunk, brief: Brief): boolean {
  const text = `${chunk.file}\n${chunk.header}\n${chunk.lines.join('\n')}`.toLowerCase()
  return brief.focus.some((term) => term.trim() !== '' && text.includes(term.trim().toLowerCase()))
}

/**
 * Highest risk first. `usage` maps a defined name to how often the repository mentions it.
 * The brief doubles a matching chunk's score and never removes a chunk.
 */
export function rankChunks(
  chunks: Chunk[],
  brief: Brief,
  usage: ReadonlyMap<string, number>,
): RankedChunk[] {
  return chunks
    .map((chunk, index) => {
      const uses = Math.max(0, ...definedNames(chunk).map((name) => usage.get(name) ?? 0))
      const briefMatch = briefMatches(chunk, brief)
      const score =
        kindWeight(chunk.file) *
        Math.log2(2 + chunk.added + chunk.removed) *
        (1 + Math.log2(1 + uses)) *
        (briefMatch ? 2 : 1)
      return { ranked: { ...chunk, score, briefMatch }, index }
    })
    .sort((a, b) => b.ranked.score - a.ranked.score || a.index - b.index)
    .map(({ ranked }) => ranked)
}

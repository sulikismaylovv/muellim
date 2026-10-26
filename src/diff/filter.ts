import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Chunk } from '../types.js'

/** Paths Muellim never sends to the AI, even when they are part of the change. Case is ignored. */
const SECRET_PATTERNS: RegExp[] = [
  /(^|\/)\.env[^/]*$/i,
  /\.(pem|key|p12|pfx|jks|keystore|ppk|p8|env|tfvars|tfstate)$/i,
  /\.(tfvars\.json|tfstate\.backup)$/i,
  /(^|\/)\.htpasswd$/i,
  /(^|\/)id_[a-z0-9_]+(\.pub)?$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)credentials(\.[a-z]+)?$/i,
  /(^|\/)\.git-credentials$/i,
  /(^|\/)\.pgpass$/i,
  /(^|\/)secring\.gpg$/i,
]

export function isSecretPath(path: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(path))
}

/** Turns one `.muellimignore` line (gitignore-style glob) into a path matcher. */
export function globToRegExp(glob: string): RegExp {
  let g = glob.trim()
  const anchored = g.startsWith('/')
  if (anchored) g = g.slice(1)
  const dirOnly = g.endsWith('/')
  if (dirOnly) g = g.slice(0, -1)
  let body = ''
  for (let i = 0; i < g.length; i++) {
    const c = g.charAt(i)
    if (c === '*' && g.charAt(i + 1) === '*') {
      i++
      if (g.charAt(i + 1) === '/') {
        body += '(.*/)?'
        i++
      } else {
        body += '.*'
      }
    } else if (c === '*') {
      body += '[^/]*'
    } else if (c === '?') {
      body += '[^/]'
    } else {
      body += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  const prefix = anchored || g.includes('/') ? '^' : '(^|.*/)'
  const suffix = dirOnly ? '/.*$' : '(/.*)?$'
  return new RegExp(prefix + body + suffix)
}

export function parseIgnore(text: string): RegExp[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map(globToRegExp)
}

/** Reads `<root>/.muellimignore`. A missing file means no patterns; other read errors throw. */
export async function loadIgnore(root: string): Promise<RegExp[]> {
  try {
    return parseIgnore(await readFile(join(root, '.muellimignore'), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Muellim's own state folder. It is never quizzed, even when the repo does not ignore it. */
const STATE_PATH = /^\.muellim\//

/** True when the path may be shown to the AI. */
export function isAllowedPath(path: string, ignore: RegExp[]): boolean {
  return (
    !STATE_PATH.test(path) && !isSecretPath(path) && !ignore.some((pattern) => pattern.test(path))
  )
}

export function filterChunks(chunks: Chunk[], ignore: RegExp[]): Chunk[] {
  return chunks.filter((chunk) => isAllowedPath(chunk.file, ignore))
}

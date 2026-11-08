import { readFileSync } from 'node:fs'
import { runFromEnv } from './main.js'

runFromEnv(process.env, (path) => readFileSync(path, 'utf8')).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

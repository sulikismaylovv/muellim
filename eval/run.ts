// Maintainer script: `npm run eval`. It calls the real AI with your key, so it costs tokens.
import { readdir, readFile } from 'node:fs/promises'
import { grade } from '../src/engine/quiz.js'
import { MuellimError } from '../src/errors.js'
import { createAiSdkClient } from '../src/providers/ai-sdk.js'
import { createModel, readConfig } from '../src/providers/config.js'
import type { LlmClient } from '../src/providers/llm.js'
import { en } from '../src/strings/en.js'
import { evalFixtureSchema, measureAgreement, TARGET_AGREEMENT } from './agreement.js'

const dir = new URL('./fixtures/', import.meta.url)
const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort()
const fixtures = await Promise.all(
  names.map(async (name) =>
    evalFixtureSchema.parse(JSON.parse(await readFile(new URL(name, dir), 'utf8'))),
  ),
)

function makeClient(): LlmClient {
  try {
    return createAiSdkClient(createModel(readConfig(process.env)), {
      maxCalls: 1_000,
      maxTokens: 5_000_000,
    })
  } catch (error) {
    if (error instanceof MuellimError) {
      console.error(en.errors[error.code])
      process.exit(1)
    }
    throw error
  }
}

const llm = makeClient()
const report = await measureAgreement(fixtures, (question, answer) => grade(llm, question, answer))

for (const miss of report.disagreements) {
  console.log(
    `DISAGREE ${miss.fixture}: expected ${miss.expected}, got ${miss.got}: ${miss.answer}`,
  )
}
const percent = (report.agreement * 100).toFixed(1)
console.log(
  `Agreement: ${percent}% (${report.cases.length - report.disagreements.length}/${report.cases.length}), target ${TARGET_AGREEMENT * 100}%`,
)
console.log(`AI usage: ${JSON.stringify(llm.usage())}`)
process.exitCode = report.agreement >= TARGET_AGREEMENT ? 0 : 1

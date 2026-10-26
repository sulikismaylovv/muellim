import {
  generateText,
  type LanguageModel,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  stepCountIs,
  ToolChoiceViolationError,
  tool,
} from 'ai'
import { z } from 'zod'
import { MuellimError } from '../errors.js'
import type { Usage } from '../types.js'
import {
  DEFAULT_LIMITS,
  type Limits,
  type LlmClient,
  type LlmRequest,
  type LookupTools,
  MAX_LOOKUPS,
} from './llm.js'

function toTools(lookups: LookupTools) {
  return {
    list_files: tool({
      description: 'List tracked files under a directory of the repository.',
      inputSchema: z.object({ dir: z.string() }),
      execute: ({ dir }) => lookups.listFiles(dir),
    }),
    read_file: tool({
      description: 'Read lines of a tracked file. At most 200 lines per call.',
      inputSchema: z.object({ path: z.string(), fromLine: z.number(), toLine: z.number() }),
      execute: ({ path, fromLine, toLine }) => lookups.readFile(path, fromLine, toLine),
    }),
    search: tool({
      description: 'Search tracked files for a fixed string. Returns path:line:text matches.',
      inputSchema: z.object({ text: z.string() }),
      execute: ({ text }) => lookups.search(text),
    }),
  }
}

class SchemaFailure extends Error {}

/** An LlmClient over the Vercel AI SDK with a call and token budget and one schema retry. */
export function createAiSdkClient(
  model: LanguageModel,
  limits: Limits = DEFAULT_LIMITS,
): LlmClient {
  const used: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 }

  async function once<T>(request: LlmRequest<T>): Promise<T> {
    if (used.calls >= limits.maxCalls || used.inputTokens + used.outputTokens >= limits.maxTokens) {
      throw new MuellimError('budget')
    }
    let steps = 0
    try {
      const result = await generateText({
        model,
        system: request.system,
        prompt: request.prompt,
        output: Output.object({ schema: request.schema }),
        tools: request.lookups ? toTools(request.lookups) : {},
        stopWhen: stepCountIs(request.lookups ? MAX_LOOKUPS + 1 : 1),
        prepareStep: ({ stepNumber }) =>
          stepNumber === MAX_LOOKUPS ? { toolChoice: 'none' } : undefined,
        onStepEnd: (step) => {
          steps += 1
          used.calls += 1
          used.inputTokens += step.usage.inputTokens ?? 0
          used.outputTokens += step.usage.outputTokens ?? 0
        },
        maxRetries: 1,
      })
      return result.output
    } catch (error) {
      if (error instanceof MuellimError) throw error
      if (steps === 0 || ToolChoiceViolationError.isInstance(error)) used.calls += 1
      if (
        NoObjectGeneratedError.isInstance(error) ||
        NoOutputGeneratedError.isInstance(error) ||
        ToolChoiceViolationError.isInstance(error)
      ) {
        throw new SchemaFailure(error.message)
      }
      throw new MuellimError('provider-unreachable', (error as Error).message)
    }
  }

  return {
    async generate(request) {
      try {
        return await once(request)
      } catch (error) {
        if (!(error instanceof SchemaFailure)) throw error
      }
      try {
        return await once(request)
      } catch (error) {
        if (error instanceof SchemaFailure) throw new MuellimError('bad-output', error.message)
        throw error
      }
    },
    usage: () => ({ ...used }),
  }
}

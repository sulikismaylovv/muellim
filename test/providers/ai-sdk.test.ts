import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MuellimError } from '../../src/errors.js'
import { createAiSdkClient } from '../../src/providers/ai-sdk.js'
import type { LookupTools } from '../../src/providers/llm.js'

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
}

const text = (body: string): LanguageModelV4GenerateResult => ({
  content: [{ type: 'text', text: body }],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage,
  warnings: [],
})

const empty: LanguageModelV4GenerateResult = {
  content: [],
  finishReason: { unified: 'length', raw: 'max_tokens' },
  usage,
  warnings: [],
}

const lookupCall = (toolName: string, input: string): LanguageModelV4GenerateResult => ({
  content: [{ type: 'tool-call', toolCallId: `t-${toolName}`, toolName, input }],
  finishReason: { unified: 'tool-calls', raw: 'tool_use' },
  usage,
  warnings: [],
})

const schema = z.object({ answer: z.string() })
const request = { purpose: 'grade' as const, system: 's', prompt: 'p', schema }

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof MuellimError) return error.code
    throw error
  }
  return 'no error'
}

describe('createAiSdkClient', () => {
  it('returns the parsed object and counts calls and tokens', async () => {
    const client = createAiSdkClient(
      new MockLanguageModelV4({ doGenerate: text('{"answer":"ok"}') }),
    )
    expect(await client.generate(request)).toEqual({ answer: 'ok' })
    expect(client.usage()).toEqual({ calls: 1, inputTokens: 100, outputTokens: 20 })
  })

  it('retries once when the output does not match the schema', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [text('{"wrong":1}'), text('{"answer":"second"}')],
    })
    expect(await createAiSdkClient(model).generate(request)).toEqual({ answer: 'second' })
  })

  it('gives up with bad-output after two unreadable answers', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [text('nope'), text('still nope')] })
    expect(await codeOf(createAiSdkClient(model).generate(request))).toBe('bad-output')
  })

  it('reports provider-unreachable when the model call throws', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:11434')
      },
    })
    expect(await codeOf(createAiSdkClient(model).generate(request))).toBe('provider-unreachable')
  })

  it('stops with budget once the call cap is reached', async () => {
    const model = new MockLanguageModelV4({ doGenerate: text('{"answer":"ok"}') })
    const client = createAiSdkClient(model, { maxCalls: 2, maxTokens: 1_000_000 })
    await client.generate(request)
    await client.generate(request)
    expect(await codeOf(client.generate(request))).toBe('budget')
  })

  it('stops with budget once the token cap is reached', async () => {
    const model = new MockLanguageModelV4({ doGenerate: text('{"answer":"ok"}') })
    const client = createAiSdkClient(model, { maxCalls: 20, maxTokens: 120 })
    await client.generate(request)
    expect(await codeOf(client.generate(request))).toBe('budget')
  })

  it('lets the model use lookups before answering', async () => {
    const reads: string[] = []
    const lookups: LookupTools = {
      listFiles: async () => '',
      readFile: async (path) => {
        reads.push(path)
        return 'export const ttl = 7'
      },
      search: async () => '',
    }
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: 'tool-call',
              toolCallId: 't1',
              toolName: 'read_file',
              input: '{"path":"src/ttl.ts","fromLine":1,"toLine":20}',
            },
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool_use' },
          usage,
          warnings: [],
        },
        text('{"answer":"7"}'),
      ],
    })
    const client = createAiSdkClient(model)
    expect(await client.generate({ ...request, purpose: 'plan', lookups })).toEqual({ answer: '7' })
    expect(reads).toEqual(['src/ttl.ts'])
    expect(client.usage().calls).toBe(2)
  })

  it('retries once when the model returns no readable output', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [empty, text('{"answer":"ok"}')] })
    expect(await createAiSdkClient(model).generate(request)).toEqual({ answer: 'ok' })
  })

  it('gives up with bad-output after two results with no output', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [empty, empty] })
    expect(await codeOf(createAiSdkClient(model).generate(request))).toBe('bad-output')
  })

  it('stops with budget when the retry after a schema failure is over the call cap', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [text('nope'), text('{"answer":"ok"}')],
    })
    const client = createAiSdkClient(model, { maxCalls: 1, maxTokens: 1_000_000 })
    expect(await codeOf(client.generate(request))).toBe('budget')
  })

  it('reports provider-unreachable when the retry after a schema failure throws', async () => {
    let calls = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1
        if (calls === 1) return text('nope')
        throw new Error('connect ECONNREFUSED')
      },
    })
    expect(await codeOf(createAiSdkClient(model).generate(request))).toBe('provider-unreachable')
  })

  it('counts a failed lookup attempt and forbids tool calls on its last step', async () => {
    const lookups: LookupTools = {
      listFiles: async () => '',
      readFile: async () => '',
      search: async () => '',
    }
    const call = lookupCall('search', '{"text":"ttl"}')
    const model = new MockLanguageModelV4({
      doGenerate: [call, call, call, text('nope'), text('{"answer":"ok"}')],
    })
    const client = createAiSdkClient(model)
    expect(await client.generate({ ...request, purpose: 'plan', lookups })).toEqual({
      answer: 'ok',
    })
    expect(client.usage()).toEqual({ calls: 5, inputTokens: 500, outputTokens: 100 })
    expect(model.doGenerateCalls[3]?.tools).toHaveLength(3)
    expect(model.doGenerateCalls[3]?.toolChoice).toEqual({ type: 'none' })
    expect(model.doGenerateCalls.slice(0, 3).map((call) => call.toolChoice)).toEqual([
      { type: 'auto' },
      { type: 'auto' },
      { type: 'auto' },
    ])
  })

  it('retries once when the model calls a tool on its last lookup step', async () => {
    const lookups: LookupTools = {
      listFiles: async () => '',
      readFile: async () => '',
      search: async () => '',
    }
    const call = lookupCall('search', '{"text":"ttl"}')
    const model = new MockLanguageModelV4({
      doGenerate: [call, call, call, call, text('{"answer":"ok"}')],
    })
    const client = createAiSdkClient(model)
    expect(await client.generate({ ...request, purpose: 'plan', lookups })).toEqual({
      answer: 'ok',
    })
    expect(client.usage()).toEqual({ calls: 5, inputTokens: 400, outputTokens: 80 })
  })

  it('gives up with bad-output after two tool calls on the last lookup step', async () => {
    const lookups: LookupTools = {
      listFiles: async () => '',
      readFile: async () => '',
      search: async () => '',
    }
    const call = lookupCall('search', '{"text":"ttl"}')
    const model = new MockLanguageModelV4({
      doGenerate: [call, call, call, call, call, call, call, call],
    })
    const client = createAiSdkClient(model)
    expect(await codeOf(client.generate({ ...request, purpose: 'plan', lookups }))).toBe(
      'bad-output',
    )
    expect(client.usage()).toEqual({ calls: 8, inputTokens: 600, outputTokens: 120 })
  })

  it('counts one call when the model call throws before any step ends', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('connect ECONNREFUSED')
      },
    })
    const client = createAiSdkClient(model)
    expect(await codeOf(client.generate(request))).toBe('provider-unreachable')
    expect(client.usage()).toEqual({ calls: 1, inputTokens: 0, outputTokens: 0 })
  })

  it('passes the arguments of each lookup to the lookup tools', async () => {
    const seen: unknown[] = []
    const lookups: LookupTools = {
      listFiles: async (dir) => {
        seen.push(['listFiles', dir])
        return ''
      },
      readFile: async (path, fromLine, toLine) => {
        seen.push(['readFile', path, fromLine, toLine])
        return ''
      },
      search: async (query) => {
        seen.push(['search', query])
        return ''
      },
    }
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            { type: 'tool-call', toolCallId: 'a', toolName: 'list_files', input: '{"dir":"src"}' },
            { type: 'tool-call', toolCallId: 'b', toolName: 'search', input: '{"text":"ttl"}' },
            {
              type: 'tool-call',
              toolCallId: 'c',
              toolName: 'read_file',
              input: '{"path":"src/ttl.ts","fromLine":3,"toLine":9}',
            },
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool_use' },
          usage,
          warnings: [],
        },
        text('{"answer":"ok"}'),
      ],
    })
    await createAiSdkClient(model).generate({ ...request, purpose: 'plan', lookups })
    expect(seen).toEqual([
      ['listFiles', 'src'],
      ['search', 'ttl'],
      ['readFile', 'src/ttl.ts', 3, 9],
    ])
  })
})

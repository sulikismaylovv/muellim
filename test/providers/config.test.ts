import { generateText } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MuellimError } from '../../src/errors.js'
import { createModel, OLLAMA_BASE_URL, readConfig } from '../../src/providers/config.js'
import { en } from '../../src/strings/en.js'

function errorOf(run: () => unknown): MuellimError {
  try {
    run()
  } catch (error) {
    if (error instanceof MuellimError) return error
    throw error
  }
  throw new Error('no error')
}

describe('readConfig', () => {
  it('reads anthropic/<model> with MUELLIM_API_KEY', () => {
    expect(
      readConfig({ MUELLIM_MODEL: 'anthropic/claude-haiku-5-5', MUELLIM_API_KEY: 'sk-m' }),
    ).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5', apiKey: 'sk-m' })
  })

  it('falls back to ANTHROPIC_API_KEY for anthropic, and MUELLIM_API_KEY wins over it', () => {
    const model = 'anthropic/claude-haiku-5-5'
    expect(readConfig({ MUELLIM_MODEL: model, ANTHROPIC_API_KEY: 'sk-a' }).apiKey).toBe('sk-a')
    expect(
      readConfig({ MUELLIM_MODEL: model, ANTHROPIC_API_KEY: 'sk-a', MUELLIM_API_KEY: 'sk-m' })
        .apiKey,
    ).toBe('sk-m')
  })

  it('uses ollama at the local default URL with no key, even when ANTHROPIC_API_KEY is set', () => {
    expect(OLLAMA_BASE_URL).toBe('http://localhost:11434/v1')
    expect(readConfig({ MUELLIM_MODEL: 'ollama/qwen3', ANTHROPIC_API_KEY: 'sk-a' })).toEqual({
      provider: 'ollama',
      model: 'qwen3',
      baseURL: 'http://localhost:11434/v1',
      apiKey: undefined,
    })
  })

  it('lets MUELLIM_BASE_URL and MUELLIM_API_KEY point ollama elsewhere', () => {
    expect(
      readConfig({
        MUELLIM_MODEL: 'ollama/qwen3',
        MUELLIM_BASE_URL: 'http://gpu-box:11434/v1',
        MUELLIM_API_KEY: 'k',
      }),
    ).toEqual({
      provider: 'ollama',
      model: 'qwen3',
      baseURL: 'http://gpu-box:11434/v1',
      apiKey: 'k',
    })
  })

  it('uses an openai-compatible server with an optional key and a model id holding slashes', () => {
    const env = {
      MUELLIM_MODEL: 'openai-compatible/meta-llama/llama-4',
      MUELLIM_BASE_URL: 'http://localhost:1234/v1',
      ANTHROPIC_API_KEY: 'sk-a',
    }
    expect(readConfig(env)).toEqual({
      provider: 'openai-compatible',
      model: 'meta-llama/llama-4',
      baseURL: 'http://localhost:1234/v1',
      apiKey: undefined,
    })
    expect(readConfig({ ...env, MUELLIM_API_KEY: 'k' }).apiKey).toBe('k')
  })

  it('ignores MUELLIM_PROVIDER', () => {
    const env = { MUELLIM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-a' }
    expect(readConfig({ ...env, MUELLIM_MODEL: 'ollama/qwen3' }).provider).toBe('ollama')
    expect(errorOf(() => readConfig(env)).code).toBe('missing-model')
  })

  it('fails with missing-model when MUELLIM_MODEL is unset, has no provider or no model', () => {
    for (const model of [undefined, '', 'qwen3', 'openai/gpt-5', 'anthropic/', '/qwen3']) {
      const env = {
        MUELLIM_MODEL: model,
        ANTHROPIC_API_KEY: 'sk-a',
        MUELLIM_BASE_URL: 'http://x/v1',
      }
      expect(errorOf(() => readConfig(env)).code, String(model)).toBe('missing-model')
    }
  })

  it('fails with missing-key for anthropic without a key and openai-compatible without a URL', () => {
    expect(errorOf(() => readConfig({ MUELLIM_MODEL: 'anthropic/claude-haiku-5-5' })).code).toBe(
      'missing-key',
    )
    expect(
      errorOf(() => readConfig({ MUELLIM_MODEL: 'openai-compatible/m', MUELLIM_API_KEY: 'k' }))
        .code,
    ).toBe('missing-key')
  })

  it('names variables in error details, never their values', () => {
    const secret = 'sk-ant-PASTED-IN-THE-WRONG-PLACE'
    for (const env of [
      { MUELLIM_MODEL: secret },
      { MUELLIM_MODEL: `unknown/${secret}` },
      { MUELLIM_MODEL: 'openai-compatible/m', MUELLIM_API_KEY: secret },
      { MUELLIM_MODEL: 'anthropic/m', MUELLIM_BASE_URL: secret },
    ]) {
      const error = errorOf(() => readConfig(env))
      expect(error.message).not.toContain(secret)
      expect(error.message).toMatch(/MUELLIM_(MODEL|API_KEY|BASE_URL)$/)
    }
  })
})

describe('setup messages', () => {
  it('show the three setups in missing-model and missing-key', () => {
    for (const code of ['missing-model', 'missing-key'] as const) {
      const text = en.errors[code]
      expect(text).toContain('MUELLIM_MODEL=anthropic/claude-haiku-5-5 with MUELLIM_API_KEY')
      expect(text).toContain('MUELLIM_MODEL=ollama/qwen3')
      expect(text).toContain('MUELLIM_MODEL=openai-compatible/<model> with MUELLIM_BASE_URL')
    }
  })
})

describe('createModel', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  /** The URL of the one request the model sends. The stubbed fetch fails it, so nothing leaves. */
  async function requestUrl(env: NodeJS.ProcessEnv): Promise<string> {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (url: string | URL | Request) => {
      urls.push(url instanceof Request ? url.url : String(url))
      throw new Error('offline')
    })
    await expect(
      generateText({ model: createModel(readConfig(env)), prompt: 'hi', maxRetries: 0 }),
    ).rejects.toThrow()
    expect(urls).toHaveLength(1)
    return urls[0] ?? ''
  }

  it('sends anthropic requests to api.anthropic.com even when ANTHROPIC_BASE_URL is set', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'http://gateway.invalid/v1')
    const url = await requestUrl({
      MUELLIM_MODEL: 'anthropic/claude-haiku-5-5',
      MUELLIM_API_KEY: 'k',
    })
    expect(url).toBe('https://api.anthropic.com/v1/messages')
  })

  it('sends ollama requests to the local default URL', async () => {
    const url = await requestUrl({ MUELLIM_MODEL: 'ollama/qwen3', ANTHROPIC_API_KEY: 'sk-a' })
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
  })

  it('sends openai-compatible requests to MUELLIM_BASE_URL', async () => {
    const url = await requestUrl({
      MUELLIM_MODEL: 'openai-compatible/meta-llama/llama-4',
      MUELLIM_BASE_URL: 'http://localhost:1234/v1',
    })
    expect(url).toBe('http://localhost:1234/v1/chat/completions')
  })
})

import { describe, expect, it } from 'vitest'
import { MuellimError } from '../../src/errors.js'
import { createModel, DEFAULT_ANTHROPIC_MODEL, readConfig } from '../../src/providers/config.js'

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof MuellimError) return error.code
    throw error
  }
  return 'no error'
}

describe('readConfig', () => {
  it('uses Anthropic with the default model when only ANTHROPIC_API_KEY is set', () => {
    expect(readConfig({ ANTHROPIC_API_KEY: 'sk-test' })).toEqual({
      provider: 'anthropic',
      model: DEFAULT_ANTHROPIC_MODEL,
      apiKey: 'sk-test',
    })
  })

  it('uses an OpenAI-compatible server when MUELLIM_BASE_URL is set, key optional', () => {
    expect(
      readConfig({ MUELLIM_BASE_URL: 'http://localhost:11434/v1', MUELLIM_MODEL: 'qwen3' }),
    ).toEqual({
      provider: 'openai-compatible',
      model: 'qwen3',
      baseURL: 'http://localhost:11434/v1',
      apiKey: undefined,
    })
  })

  it('prefers MUELLIM_BASE_URL over an ANTHROPIC_API_KEY that is also set', () => {
    const env = { ANTHROPIC_API_KEY: 'sk-test', MUELLIM_BASE_URL: 'http://localhost:1234/v1' }
    expect(readConfig({ ...env, MUELLIM_MODEL: 'qwen3' })).toEqual({
      provider: 'openai-compatible',
      model: 'qwen3',
      baseURL: 'http://localhost:1234/v1',
      apiKey: undefined,
    })
    expect(codeOf(() => readConfig(env))).toBe('missing-model')
  })

  it('lets MUELLIM_PROVIDER choose when both are set', () => {
    const config = readConfig({
      ANTHROPIC_API_KEY: 'sk-test',
      MUELLIM_BASE_URL: 'http://localhost:1234/v1',
      MUELLIM_MODEL: 'local',
      MUELLIM_PROVIDER: 'openai-compatible',
    })
    expect(config.provider).toBe('openai-compatible')
    expect(
      readConfig({
        ANTHROPIC_API_KEY: 'sk-test',
        MUELLIM_BASE_URL: 'http://localhost:1234/v1',
        MUELLIM_PROVIDER: 'anthropic',
      }).provider,
    ).toBe('anthropic')
  })

  it('fails with missing-key when nothing is set, and missing-model without a model', () => {
    expect(codeOf(() => readConfig({}))).toBe('missing-key')
    expect(codeOf(() => readConfig({ MUELLIM_PROVIDER: 'anthropic' }))).toBe('missing-key')
    expect(codeOf(() => readConfig({ MUELLIM_BASE_URL: 'http://localhost:1/v1' }))).toBe(
      'missing-model',
    )
  })
})

describe('createModel', () => {
  it('builds a model for both providers without calling the network', () => {
    expect(createModel(readConfig({ ANTHROPIC_API_KEY: 'sk-test' }))).toBeTruthy()
    expect(
      createModel(readConfig({ MUELLIM_BASE_URL: 'http://localhost:1/v1', MUELLIM_MODEL: 'm' })),
    ).toBeTruthy()
  })
})

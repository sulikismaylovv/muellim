import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { MuellimError } from '../errors.js'

export const OLLAMA_BASE_URL = 'http://localhost:11434/v1'
/** Passed explicitly, so ANTHROPIC_BASE_URL, which the AI SDK would read, never moves the code. */
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1'

export type ProviderConfig =
  | { provider: 'anthropic'; model: string; apiKey: string }
  | {
      provider: 'ollama' | 'openai-compatible'
      model: string
      baseURL: string
      apiKey: string | undefined
    }

/**
 * Reads the provider from the environment. MUELLIM_MODEL names it as <provider>/<model>, split at
 * the first slash:
 * - anthropic/<model> with MUELLIM_API_KEY, or ANTHROPIC_API_KEY when MUELLIM_API_KEY is unset;
 * - ollama/<model> at MUELLIM_BASE_URL or the local default, with no key needed;
 * - openai-compatible/<model> at MUELLIM_BASE_URL, with an optional MUELLIM_API_KEY.
 * No other variable decides where code is sent. Error details name variables, never their values.
 */
export function readConfig(env: NodeJS.ProcessEnv): ProviderConfig {
  const value = env.MUELLIM_MODEL ?? ''
  const slash = value.indexOf('/')
  const provider = slash < 0 ? '' : value.slice(0, slash)
  const model = slash < 0 ? '' : value.slice(slash + 1)
  const apiKey = env.MUELLIM_API_KEY || undefined
  if (model && provider === 'anthropic') {
    const key = apiKey ?? env.ANTHROPIC_API_KEY
    if (!key) throw new MuellimError('missing-key', 'MUELLIM_API_KEY')
    return { provider, model, apiKey: key }
  }
  if (model && provider === 'ollama') {
    return { provider, model, baseURL: env.MUELLIM_BASE_URL || OLLAMA_BASE_URL, apiKey }
  }
  if (model && provider === 'openai-compatible') {
    if (!env.MUELLIM_BASE_URL) throw new MuellimError('missing-key', 'MUELLIM_BASE_URL')
    return { provider, model, baseURL: env.MUELLIM_BASE_URL, apiKey }
  }
  throw new MuellimError('missing-model', 'MUELLIM_MODEL')
}

export function createModel(config: ProviderConfig): LanguageModel {
  if (config.provider === 'anthropic') {
    return createAnthropic({ apiKey: config.apiKey, baseURL: ANTHROPIC_BASE_URL })(config.model)
  }
  return createOpenAICompatible({
    name: 'muellim-openai-compatible',
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  })(config.model)
}

import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { MuellimError } from '../errors.js'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5'

export type ProviderConfig =
  | { provider: 'anthropic'; model: string; apiKey: string }
  | { provider: 'openai-compatible'; model: string; baseURL: string; apiKey: string | undefined }

/**
 * Reads the provider from the environment. The user brings their own key:
 * ANTHROPIC_API_KEY, or MUELLIM_BASE_URL (+ MUELLIM_MODEL, optional MUELLIM_API_KEY)
 * for any OpenAI-compatible server such as OpenAI, Ollama, LM Studio or OpenRouter.
 * MUELLIM_PROVIDER picks one when both are set.
 */
export function readConfig(env: NodeJS.ProcessEnv): ProviderConfig {
  const provider =
    env.MUELLIM_PROVIDER ??
    (env.ANTHROPIC_API_KEY ? 'anthropic' : env.MUELLIM_BASE_URL ? 'openai-compatible' : undefined)

  if (provider === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new MuellimError('missing-key', 'ANTHROPIC_API_KEY')
    return {
      provider,
      model: env.MUELLIM_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
      apiKey: env.ANTHROPIC_API_KEY,
    }
  }
  if (provider === 'openai-compatible') {
    if (!env.MUELLIM_BASE_URL) throw new MuellimError('missing-key', 'MUELLIM_BASE_URL')
    if (!env.MUELLIM_MODEL) throw new MuellimError('missing-model')
    return {
      provider,
      model: env.MUELLIM_MODEL,
      baseURL: env.MUELLIM_BASE_URL,
      apiKey: env.MUELLIM_API_KEY,
    }
  }
  throw new MuellimError('missing-key', provider ? `unknown provider ${provider}` : '')
}

export function createModel(config: ProviderConfig): LanguageModel {
  if (config.provider === 'anthropic') {
    return createAnthropic({ apiKey: config.apiKey })(config.model)
  }
  return createOpenAICompatible({
    name: 'muellim-openai-compatible',
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  })(config.model)
}

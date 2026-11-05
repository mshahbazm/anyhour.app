import type { tLlmProviderId } from '../../../../config/models.config'
import { openAiLlm } from './openai'
import type { iLlmProvider } from './types'

// Language model providers by id (LLM_PROVIDER). A new provider is one file
// beside openai.ts and one line here.
export const llmProviders = {
  openai: openAiLlm,
} as const satisfies Record<tLlmProviderId, iLlmProvider>

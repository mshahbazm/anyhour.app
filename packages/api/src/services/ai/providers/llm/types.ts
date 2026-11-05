import type { ResponseInputItem } from 'openai/resources/responses/responses'
import type { z } from 'zod'

// What every language model provider does. Providers take a resolved model
// id and plain settings; tasks, usage records and ApiError stay in
// services/ai/llm.ts. Errors carry an HTTP-like `status` when the provider
// gave one.

/** Plain text, or input items for files and images. */
export type tLlmInput = string | ResponseInputItem[]
export type tReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh'

export interface iLlmCall {
  model: string
  effort: tReasoningEffort
  maxOutputTokens?: number
  serviceTier?: 'flex'
  instructions: string
  input: tLlmInput
  timeoutMs: number
  maxRetries: number
  signal?: AbortSignal
}

export interface iLlmTokens {
  /** The model that served the call, as the provider names it. */
  model: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
}

export interface iEmbedCall {
  model: string
  dimensions: number
  input: string[]
  timeoutMs: number
  maxRetries: number
  signal?: AbortSignal
}

export interface iImageCall {
  model: string
  prompt: string
  size: '1024x1024' | '1024x1536' | '1536x1024'
  quality: 'low' | 'medium' | 'high'
  format: 'png' | 'jpeg' | 'webp'
  compression: number
  timeoutMs: number
}

export interface iAgentSettings {
  model: string
  effort: tReasoningEffort
  verbosity: 'low' | 'medium' | 'high'
}

export interface iLlmProvider {
  generateText(call: iLlmCall): Promise<{ text: string; usage: iLlmTokens }>
  /** The parsed value is checked against the schema again by the caller. */
  generateObject(
    call: iLlmCall & { schema: z.ZodType; schemaName: string },
  ): Promise<{ value: unknown; usage: iLlmTokens }>
  /** One vector per input, in input order (not yet validated). */
  embed(call: iEmbedCall): Promise<{ vectors: number[][]; tokens: number }>
  /** The image as base64, or null when none came back. */
  generateImage(call: iImageCall): Promise<{ base64: string | null }>
  /**
   * The chat agents' model in the OpenAI Agents SDK's shape, with the SDK's
   * key set. The agents run on that SDK whatever serves them.
   */
  agentModel(settings: iAgentSettings): {
    model: string
    modelSettings: {
      reasoning: { effort: tReasoningEffort }
      text: { verbosity: 'low' | 'medium' | 'high' }
    }
  }
}

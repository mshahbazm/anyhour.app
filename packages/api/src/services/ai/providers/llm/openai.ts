import { setDefaultOpenAIKey } from '@openai/agents'
import { zodTextFormat } from 'openai/helpers/zod'
import { getOpenAi } from '../openAiClient'
import type { iLlmCall, iLlmProvider, iLlmTokens } from './types'

function body(call: iLlmCall) {
  return {
    model: call.model,
    reasoning: { effort: call.effort },
    max_output_tokens: call.maxOutputTokens,
    ...(call.serviceTier ? { service_tier: call.serviceTier } : {}),
    instructions: call.instructions,
    input: call.input,
    store: false,
  }
}

function options(call: {
  timeoutMs: number
  maxRetries: number
  signal?: AbortSignal
}) {
  return {
    timeout: call.timeoutMs,
    maxRetries: call.maxRetries,
    signal: call.signal,
  }
}

function tokens(response: {
  model: string
  usage?: {
    input_tokens: number
    input_tokens_details?: { cached_tokens?: number } | null
    output_tokens: number
  } | null
}): iLlmTokens {
  return {
    model: response.model,
    inputTokens: response.usage?.input_tokens ?? 0,
    cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  }
}

export const openAiLlm: iLlmProvider = {
  async generateText(call) {
    const response = await getOpenAi().responses.create(
      body(call),
      options(call),
    )
    return { text: response.output_text, usage: tokens(response) }
  },

  async generateObject(call) {
    const response = await getOpenAi().responses.parse(
      {
        ...body(call),
        text: { format: zodTextFormat(call.schema, call.schemaName) },
      },
      options(call),
    )
    return { value: response.output_parsed, usage: tokens(response) }
  },

  async embed(call) {
    const response = await getOpenAi().embeddings.create(
      { model: call.model, dimensions: call.dimensions, input: call.input },
      options(call),
    )
    const byIndex = new Map(
      response.data.map((item) => [item.index, item.embedding]),
    )
    return {
      // A missing or duplicated index leaves a hole the caller rejects.
      vectors:
        response.data.length === call.input.length
          ? call.input.map((_, index) => byIndex.get(index) ?? [])
          : [],
      tokens: response.usage.total_tokens,
    }
  },

  async generateImage(call) {
    const response = await getOpenAi().images.generate(
      {
        model: call.model,
        prompt: call.prompt,
        size: call.size,
        quality: call.quality,
        output_format: call.format,
        output_compression: call.compression,
        n: 1,
      },
      { timeout: call.timeoutMs },
    )
    return { base64: response.data?.[0]?.b64_json ?? null }
  },

  agentModel(settings) {
    setDefaultOpenAIKey(getOpenAi().apiKey ?? '')
    return {
      model: settings.model,
      modelSettings: {
        reasoning: { effort: settings.effort },
        text: { verbosity: settings.verbosity },
      },
    }
  },
}

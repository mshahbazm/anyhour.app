import { zodTextFormat } from 'openai/helpers/zod'
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses'
import type { z } from 'zod'
import { costUsd, languageModels, llmTasks } from '../../config/models.config'
import type { tLlmTask } from '../../config/models.config'
import { db } from '../../db'
import { aiUsageEvent } from '../../db/schema'
import { ApiError } from '../http/apiError'
import { getOpenAi } from './openAi'

// Who a call was made for, so its cost is recorded against them.
export interface iLlmUsageContext {
  organizationId: string
  assistantId?: string
  sourceId?: string
}

export interface iLlmRequest {
  /** The purpose; its model and limits live in config/models.config.ts. */
  task: tLlmTask
  instructions: string
  /** Plain text, or SDK input items for files and images. */
  input: string | Exclude<ResponseCreateParamsNonStreaming['input'], undefined>
  maxRetries?: number
  signal?: AbortSignal
  /** Records the call in ai_usage_event when given. */
  usage?: iLlmUsageContext
}

export interface iLlmUsage {
  model: string
  inputTokens: number
  outputTokens: number
}

function requestOptions(request: iLlmRequest) {
  return {
    timeout: llmTasks[request.task].timeoutMs,
    maxRetries: request.maxRetries ?? 1,
    signal: request.signal,
  }
}

function settings(request: iLlmRequest) {
  const task: {
    model: keyof typeof languageModels
    effort: NonNullable<ResponseCreateParamsNonStreaming['reasoning']>['effort']
    max_output_tokens?: number
  } = llmTasks[request.task]
  return {
    model: languageModels[task.model].id,
    reasoning: { effort: task.effort },
    max_output_tokens: task.max_output_tokens,
  }
}

async function record(request: iLlmRequest, usage: iLlmUsage) {
  if (!request.usage || !(usage.inputTokens || usage.outputTokens)) return
  // Usage records never fail the call they describe.
  await db
    .insert(aiUsageEvent)
    .values({
      ...request.usage,
      kind: request.task,
      provider: 'openai',
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: costUsd(
        llmTasks[request.task].model,
        usage.inputTokens,
        usage.outputTokens,
      ),
    })
    .catch(() => undefined)
}

function usageOf(response: {
  model: string
  usage?: { input_tokens: number; output_tokens: number } | null
}): iLlmUsage {
  return {
    model: response.model,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  }
}

// Provider errors can echo prompts or keys; callers only get a classified ApiError.
function classify(error: unknown): never {
  if (error instanceof ApiError) throw error
  const status =
    error && typeof error === 'object' && 'status' in error
      ? error.status
      : undefined
  if (status === 429)
    throw new ApiError(
      429,
      'ai_rate_limited',
      'The AI service is busy. Please try again shortly.',
    )
  if (status === 400)
    throw new ApiError(
      422,
      'ai_rejected',
      'The AI service could not process this request.',
    )
  throw new ApiError(
    503,
    'ai_unavailable',
    'The AI service is unavailable. Please try again.',
  )
}

export async function generateText(request: iLlmRequest) {
  try {
    const response = await getOpenAi().responses.create(
      {
        ...settings(request),
        instructions: request.instructions,
        input: request.input,
        store: false,
      },
      requestOptions(request),
    )
    const usage = usageOf(response)
    await record(request, usage)
    return { text: response.output_text, usage }
  } catch (error) {
    classify(error)
  }
}

// Structured output validated against a Zod schema (strict JSON schema on the provider side).
export async function generateObject<TSchema extends z.ZodType>(
  request: iLlmRequest & { schema: TSchema; schemaName: string },
): Promise<{ value: z.infer<TSchema>; usage: iLlmUsage }> {
  let response
  try {
    response = await getOpenAi().responses.parse(
      {
        ...settings(request),
        instructions: request.instructions,
        input: request.input,
        store: false,
        text: { format: zodTextFormat(request.schema, request.schemaName) },
      },
      requestOptions(request),
    )
  } catch (error) {
    classify(error)
  }
  const parsed = request.schema.safeParse(response.output_parsed)
  if (!parsed.success)
    throw new ApiError(
      503,
      'ai_invalid_output',
      'The AI service returned an unexpected answer. Please try again.',
    )
  const usage = usageOf(response)
  await record(request, usage)
  return { value: parsed.data, usage }
}

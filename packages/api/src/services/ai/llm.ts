import type { z } from 'zod'
import {
  agentModels,
  costUsd,
  embeddingModel,
  imageModel,
  languageModels,
  llmTasks,
} from '../../config/models.config'
import type {
  tAgent,
  tLanguageModel,
  tLlmTask,
  tServiceTier,
} from '../../config/models.config'
import { db } from '../../db'
import { aiUsageEvent } from '../../db/schema'
import { env } from '../../env'
import { ApiError } from '../http/apiError'
import { ProviderUnconfiguredError } from './providers/errors'
import { llmProviders } from './providers/llm'
import type {
  iImageCall,
  iLlmCall,
  tLlmInput,
  tReasoningEffort,
} from './providers/llm/types'

// Language model calls for the whole API: a task picks the model and limits
// in config/models.config.ts, the provider (LLM_PROVIDER) serves it, and its
// cost is recorded in ai_usage_event when `usage` is given.

const provider = () => llmProviders[env.LLM_PROVIDER]

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
  /** Plain text, or input items for files and images. */
  input: tLlmInput
  maxRetries?: number
  signal?: AbortSignal
  /** Records the call in ai_usage_event when given. */
  usage?: iLlmUsageContext
}

export interface iLlmUsage {
  model: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
}

/** A call outside the task table (scripts, evals): explicit settings. */
export interface iRawLlmRequest {
  model: tLanguageModel
  effort: tReasoningEffort
  maxOutputTokens?: number
  serviceTier?: tServiceTier
  timeoutMs: number
  instructions: string
  input: tLlmInput
  maxRetries?: number
  signal?: AbortSignal
  /** Records the call under this kind when given. */
  usage?: iLlmUsageContext & {
    kind: (typeof aiUsageEvent.$inferInsert)['kind']
  }
}

interface iResolved {
  call: iLlmCall
  model: tLanguageModel
  serviceTier?: tServiceTier
  record?: iRawLlmRequest['usage']
}

function fromTask(request: iLlmRequest): iResolved {
  const task: {
    model: tLanguageModel
    effort: tReasoningEffort
    max_output_tokens?: number
    timeoutMs: number
    serviceTier?: tServiceTier
  } = llmTasks[request.task]
  return {
    model: task.model,
    serviceTier: task.serviceTier,
    record: request.usage && { ...request.usage, kind: request.task },
    call: {
      model: languageModels[task.model].id,
      effort: task.effort,
      maxOutputTokens: task.max_output_tokens,
      serviceTier: task.serviceTier,
      instructions: request.instructions,
      input: request.input,
      timeoutMs: task.timeoutMs,
      maxRetries: request.maxRetries ?? 1,
      signal: request.signal,
    },
  }
}

function fromRaw(request: iRawLlmRequest): iResolved {
  return {
    model: request.model,
    serviceTier: request.serviceTier,
    record: request.usage,
    call: {
      model: languageModels[request.model].id,
      effort: request.effort,
      maxOutputTokens: request.maxOutputTokens,
      serviceTier: request.serviceTier,
      instructions: request.instructions,
      input: request.input,
      timeoutMs: request.timeoutMs,
      maxRetries: request.maxRetries ?? 1,
      signal: request.signal,
    },
  }
}

async function record(resolved: iResolved, usage: iLlmUsage) {
  if (!resolved.record || !(usage.inputTokens || usage.outputTokens)) return
  // Usage records never fail the call they describe.
  await db
    .insert(aiUsageEvent)
    .values({
      ...resolved.record,
      provider: env.LLM_PROVIDER,
      model: usage.model,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      costUsd: costUsd(resolved.model, usage, resolved.serviceTier),
    })
    .catch(() => undefined)
}

// Provider errors can echo prompts or keys; callers only get a classified ApiError.
function classify(error: unknown): never {
  if (error instanceof ApiError) throw error
  if (error instanceof ProviderUnconfiguredError)
    throw new ApiError(503, 'ai_unconfigured', 'AI service is not configured')
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

async function runText(resolved: iResolved) {
  let result
  try {
    result = await provider().generateText(resolved.call)
  } catch (error) {
    classify(error)
  }
  await record(resolved, result.usage)
  return result
}

async function runObject<TSchema extends z.ZodType>(
  resolved: iResolved,
  schema: TSchema,
  schemaName: string,
): Promise<{ value: z.infer<TSchema>; usage: iLlmUsage }> {
  let result
  try {
    result = await provider().generateObject({
      ...resolved.call,
      schema,
      schemaName,
    })
  } catch (error) {
    classify(error)
  }
  // The provider's own parsing is not trusted: check against the schema here.
  const parsed = schema.safeParse(result.value)
  if (!parsed.success)
    throw new ApiError(
      503,
      'ai_invalid_output',
      'The AI service returned an unexpected answer. Please try again.',
    )
  await record(resolved, result.usage)
  return { value: parsed.data, usage: result.usage }
}

export function generateText(
  request: iLlmRequest,
): Promise<{ text: string; usage: iLlmUsage }> {
  return runText(fromTask(request))
}

// Structured output validated against a Zod schema (strict JSON schema on the provider side).
export function generateObject<TSchema extends z.ZodType>(
  request: iLlmRequest & { schema: TSchema; schemaName: string },
): Promise<{ value: z.infer<TSchema>; usage: iLlmUsage }> {
  return runObject(fromTask(request), request.schema, request.schemaName)
}

/** A direct call with explicit settings, for work that isn't a task. */
export function callLlm<TSchema extends z.ZodType>(
  request: iRawLlmRequest & { schema: TSchema; schemaName: string },
): Promise<{ value: z.infer<TSchema>; usage: iLlmUsage }>
export function callLlm(
  request: iRawLlmRequest,
): Promise<{ text: string; usage: iLlmUsage }>
export function callLlm(
  request: iRawLlmRequest & { schema?: z.ZodType; schemaName?: string },
) {
  return request.schema
    ? runObject(
        fromRaw(request),
        request.schema,
        request.schemaName ?? 'output',
      )
    : runText(fromRaw(request))
}

/**
 * Vectors for search, with the configured embedding model. Not recorded
 * here: knowledge indexing checkpoints its batches and records them itself.
 */
export async function embed(
  input: string[],
  options: {
    signal?: AbortSignal
    timeoutMs?: number
    maxRetries?: number
  } = {},
) {
  try {
    return await provider().embed({
      model: embeddingModel.id,
      dimensions: embeddingModel.dimensions,
      input,
      timeoutMs: options.timeoutMs ?? 45_000,
      maxRetries: options.maxRetries ?? 2,
      signal: options.signal,
    })
  } catch (error) {
    // An abort is the caller's own deadline, not a provider failure.
    if (options.signal?.aborted) throw error
    classify(error)
  }
}

/** One image with the configured image model, as base64 (null if none). */
export async function generateImage(
  request: Omit<iImageCall, 'model'>,
): Promise<{ base64: string | null }> {
  try {
    return await provider().generateImage({ ...request, model: imageModel })
  } catch (error) {
    classify(error)
  }
}

/**
 * A chat agent's model and settings for the OpenAI Agents SDK, with its key
 * set from the provider config. Throws ai_unconfigured without a key.
 */
export function agentModel(agent: tAgent) {
  const settings = agentModels[agent]
  try {
    return provider().agentModel({
      model: languageModels[settings.model].id,
      effort: settings.effort,
      verbosity: settings.verbosity,
    })
  } catch (error) {
    classify(error)
  }
}

import {
  decisionModels,
  decisionProviderTraits,
  decisionTasks,
  priceUsd,
} from '../../config/models.config'
import type {
  iDecisionLimits,
  iPricing,
  tDecisionProviderId,
  tDecisionTask,
} from '../../config/models.config'
import { db } from '../../db'
import { aiUsageEvent } from '../../db/schema'
import { env } from '../../env'
import { ProviderUnconfiguredError } from './providers/errors'
import { decisionProviders } from './providers/decisions'
import {
  DecisionProviderError,
  type tDecisionAnswer,
  type tDecisionInput,
  type tDecisionQuestion,
} from './providers/decisions/types'
import type { iLlmUsageContext } from './llm'

// Typed judgments for the whole API: a task picks the model, limits and
// tries per provider in config/models.config.ts; the provider
// (DECISION_PROVIDER) answers. Callers get answers typed by question.

export type { tDecisionInput, tDecisionQuestion }
/** A failed call, classified (network, busy, contextLimit, …). */
export { DecisionProviderError as DecisionError }

/** A busy provider asked us to come back later than is worth waiting. */
export class DecisionDeferred extends Error {
  constructor(readonly retryAt: number) {
    super('Decision retry deferred')
  }
}

// Waits up to this long in place; longer and the caller reschedules.
const maxWaitMs = 5000

type tName<Q> = Q extends { name: infer N extends string } ? N : string
type tChoiceValue<Q> = Q extends {
  choices: readonly { value: infer V extends string }[]
}
  ? V
  : string

/** The answer to one question, typed by its kind (and choices). */
export type tAnswerOf<Q extends tDecisionQuestion> =
  | (Q extends { kind: 'predicate' }
      ? { kind: 'predicate'; name: tName<Q>; probability: number }
      : never)
  | (Q extends { kind: 'choice' }
      ? {
          kind: 'choice'
          name: tName<Q>
          choice: tChoiceValue<Q>
          confidence: number
          probabilities: Record<tChoiceValue<Q>, number>
        }
      : never)
  | (Q extends { kind: 'score' }
      ? {
          kind: 'score'
          name: tName<Q>
          score: number
          confidence: number
          probabilities: number[]
        }
      : never)
  | { kind: 'refusal'; name: tName<Q>; reason: 'declined' | 'invalid' }

/** Answers by position: answers[i] answers questions[i]. */
export type tAnswers<Q extends readonly tDecisionQuestion[]> = {
  -readonly [K in keyof Q]: tAnswerOf<Q[K]>
}

export interface iDecisionUsage {
  provider: tDecisionProviderId
  /** The model that answered, as the provider names it. */
  model: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  costUsd: string
}

export interface iDecision<Q extends readonly tDecisionQuestion[]> {
  answers: tAnswers<Q>
  usage: iDecisionUsage
}

export interface iDecideRequest<Q extends readonly tDecisionQuestion[]> {
  /** The purpose; its model, limits and tries live in models.config.ts. */
  task: tDecisionTask
  /** Shared by every question (and cached by providers that can). */
  input: tDecisionInput
  questions: Q
  /** Overrides the task's tries, e.g. 1 when the caller retries itself. */
  attempts?: number
  signal?: AbortSignal
  /** Records the call in ai_usage_event when given. */
  usage?: iLlmUsageContext
}

/** Conservative size of a request: its JSON bytes plus some overhead. */
export const estimateSize = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), 'utf8') + 256

/** Whether the configured decision provider has its key. */
export const decisionsConfigured = () =>
  decisionProviders[env.DECISION_PROVIDER].configured()

/** The request limits of a task on the configured provider. */
export const decisionLimits = (task: tDecisionTask): iDecisionLimits =>
  decisionTasks[task].limits[env.DECISION_PROVIDER]

/**
 * Whether the configured provider wants shared instructions and criteria in
 * the input, with short questions (see decisionProviderTraits).
 */
export const instructionsInInput = (): boolean =>
  decisionProviderTraits[env.DECISION_PROVIDER].instructionsInInput

/** The model a task uses on the configured provider. */
export const decisionModel = (task: tDecisionTask): string =>
  decisionTasks[task].models[env.DECISION_PROVIDER]

/**
 * Every provider's answers pass through here. Rounded probabilities can
 * total 0.98–1.02; the choice must be the most likely value. Anything else
 * is no answer.
 */
export function checkAnswer(answer: tDecisionAnswer): tDecisionAnswer {
  if (answer.kind !== 'choice') return answer
  const values = Object.values(answer.probabilities)
  const total = values.reduce((sum, value) => sum + value, 0)
  return Math.abs(total - 1) <= 0.020001 &&
    answer.probabilities[answer.choice] >= Math.max(...values) - 0.00001
    ? answer
    : { kind: 'refusal', name: answer.name, reason: 'invalid' }
}

interface iRun {
  provider: tDecisionProviderId
  model: string
  pricing: iPricing
  limits?: iDecisionLimits
  timeoutMs: number
  attempts: number
  input: tDecisionInput
  questions: readonly tDecisionQuestion[]
  signal?: AbortSignal
  record?: iLlmUsageContext & { kind: 'cleanup' | 'scopePlan' }
}

async function run(request: iRun) {
  const { limits } = request
  if (
    limits &&
    (request.questions.length > limits.questions ||
      estimateSize({ input: request.input, questions: request.questions }) >
        limits.requestBytes)
  )
    throw new DecisionProviderError('rejected')
  const provider = decisionProviders[request.provider]
  for (let attempt = 1; ; attempt++) {
    let result
    try {
      result = await provider.decide({
        model: request.model,
        input: request.input,
        questions: request.questions,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      })
    } catch (error) {
      const failure =
        error instanceof DecisionProviderError
          ? error
          : new DecisionProviderError(
              error instanceof ProviderUnconfiguredError
                ? 'authentication'
                : 'network',
            )
      const transient = ['network', 'busy', 'unavailable'].includes(
        failure.failure,
      )
      if (!transient || attempt >= request.attempts) throw failure
      const delay =
        failure.retryAfterMs ??
        1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250)
      if (delay > maxWaitMs)
        throw new DecisionDeferred(
          Date.now() + Math.min(delay, 24 * 60 * 60_000),
        )
      await Bun.sleep(Math.max(250, delay))
      continue
    }
    const usage: iDecisionUsage = {
      provider: request.provider,
      model: result.model,
      ...result.usage,
      costUsd: priceUsd(request.pricing, result.usage),
    }
    if (request.record && (usage.inputTokens || usage.outputTokens))
      // Usage records never fail the call they describe.
      await db
        .insert(aiUsageEvent)
        .values({
          ...request.record,
          provider: usage.provider,
          model: usage.model,
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.costUsd,
        })
        .catch(() => undefined)
    return { answers: result.answers.map(checkAnswer), usage }
  }
}

/**
 * Asks the task's questions about one input. Throws DecisionError when the
 * provider fails after the task's tries, or DecisionDeferred when it asks
 * for more time than is worth waiting.
 */
export async function decide<const Q extends readonly tDecisionQuestion[]>(
  request: iDecideRequest<Q>,
): Promise<iDecision<Q>> {
  const provider = env.DECISION_PROVIDER
  const task = decisionTasks[request.task]
  const model = decisionModel(request.task)
  const result = await run({
    provider,
    model,
    pricing: (decisionModels[provider] as Record<string, iPricing>)[model],
    limits: task.limits[provider],
    timeoutMs: task.timeoutMs,
    attempts: request.attempts ?? task.attempts,
    input: request.input,
    questions: request.questions,
    signal: request.signal,
    record: request.usage && { ...request.usage, kind: task.usageKind },
  })
  return result as iDecision<Q>
}

/** A direct call with an explicit provider and model (scripts, evals). */
export async function callDecisions<
  const Q extends readonly tDecisionQuestion[],
>(request: {
  provider: tDecisionProviderId
  /** One of that provider's models in decisionModels. */
  model: string
  input: tDecisionInput
  questions: Q
  timeoutMs: number
  attempts?: number
  signal?: AbortSignal
  usage?: iLlmUsageContext & { kind: 'cleanup' | 'scopePlan' }
}): Promise<iDecision<Q>> {
  const pricing = (
    decisionModels[request.provider] as Record<string, iPricing | undefined>
  )[request.model]
  if (!pricing)
    throw new Error(`${request.model} is not a ${request.provider} model`)
  const result = await run({
    provider: request.provider,
    model: request.model,
    pricing,
    timeoutMs: request.timeoutMs,
    attempts: request.attempts ?? 1,
    input: request.input,
    questions: request.questions,
    signal: request.signal,
    record: request.usage,
  })
  return result as iDecision<Q>
}

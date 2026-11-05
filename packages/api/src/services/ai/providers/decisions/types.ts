// What every decision provider does: typed judgments about one shared input.
// Providers take a resolved model id and plain questions, parse the
// response with Zod and return answers in question order. Tasks, limits,
// usage records and retries stay in services/ai/decisions.ts.

/** Text, or JSON-like data (sent as JSON text where a provider needs it). */
export type tDecisionInput = string | Record<string, unknown>

export interface iChoiceOption {
  value: string
  description?: string
}
export interface iScoreLevel {
  label: string
  description?: string
}

export type tDecisionQuestion =
  /** How likely a statement about the input is true. */
  | { kind: 'predicate'; name: string; instructions: string }
  /** One of a defined set. */
  | {
      kind: 'choice'
      name: string
      instructions: string
      choices: readonly iChoiceOption[]
    }
  /** A position on ordered levels, low to high. */
  | {
      kind: 'score'
      name: string
      instructions: string
      levels: readonly iScoreLevel[]
    }

export type tDecisionAnswer =
  | { kind: 'predicate'; name: string; probability: number }
  | {
      kind: 'choice'
      name: string
      choice: string
      confidence: number
      probabilities: Record<string, number>
    }
  | {
      kind: 'score'
      name: string
      /** Probability-weighted level index, so it can fall between levels. */
      score: number
      confidence: number
      /** By level index. */
      probabilities: number[]
    }
  /**
   * No answer: the model declined, or what came back didn't fit the
   * question (wrong type, unknown choice, missing).
   */
  | { kind: 'refusal'; name: string; reason: 'declined' | 'invalid' }

export interface iDecisionCall {
  model: string
  input: tDecisionInput
  questions: readonly tDecisionQuestion[]
  timeoutMs: number
  signal?: AbortSignal
}

export interface iDecisionResult {
  /** The model that answered, as the provider names it. */
  model: string
  answers: tDecisionAnswer[]
  usage: {
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
  }
}

export interface iDecisionProvider {
  /** Whether its key is in the environment. */
  configured(): boolean
  decide(call: iDecisionCall): Promise<iDecisionResult>
}

export type tDecisionFailure =
  /** No response: connection, timeout, or a local limiter gave up. */
  | 'network'
  /** The request was too large for the model. */
  | 'contextLimit'
  | 'authentication'
  /** Any other refused request; retrying won't help. */
  | 'rejected'
  /** Rate limited or overloaded (429/529). */
  | 'busy'
  /** Server failure (5xx). */
  | 'unavailable'
  /** A success response that isn't the documented shape. */
  | 'invalidResponse'

/** A failed call, classified. Never carries the request or response body. */
export class DecisionProviderError extends Error {
  constructor(
    readonly failure: tDecisionFailure,
    /** When the provider said when to come back. */
    readonly retryAfterMs?: number,
  ) {
    super(`Decision provider failed: ${failure}`)
  }
}

const contextLimit =
  /(?:context|token|input|state).{0,80}(?:too (?:long|large)|exceed|maximum|limit)|context_length_exceeded/iu

// Classifies a non-OK HTTP response. Reads the body only to recognise an
// explicit context-size rejection; it is never logged or kept.
export async function httpFailure(response: Response, now = Date.now()) {
  const body = (await response.text().catch(() => '')).slice(0, 4000)
  const { status } = response
  if ([400, 413, 422].includes(status) && contextLimit.test(body))
    return new DecisionProviderError('contextLimit')
  if (status === 401 || status === 403)
    return new DecisionProviderError('authentication')
  if (status !== 429 && status !== 529 && status < 500)
    return new DecisionProviderError('rejected')
  const header = response.headers.get('retry-after')
  const retryAfterMs = header
    ? /^\d+(?:\.\d+)?$/u.test(header)
      ? Number(header) * 1000
      : Date.parse(header) - now
    : undefined
  return new DecisionProviderError(
    status >= 500 && status !== 529 ? 'unavailable' : 'busy',
    retryAfterMs !== undefined && Number.isFinite(retryAfterMs)
      ? Math.max(0, retryAfterMs)
      : undefined,
  )
}

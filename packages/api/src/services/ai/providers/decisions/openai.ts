import { z } from 'zod'
import { getOpenAi } from '../openAiClient'
import {
  DecisionProviderError,
  httpFailure,
  type iDecisionProvider,
  type tDecisionAnswer,
  type tDecisionQuestion,
} from './types'

// OpenAI Decisions (POST /v1/decisions). The installed SDK has no decisions
// resource, so this calls the endpoint and parses the documented response.
// https://developers.openai.com/api/reference/resources/decisions/methods/create

const endpoint = 'https://api.openai.com/v1/decisions'
const probability = z.number().min(0).max(1)
const tokenCount = z.number().int().nonnegative()

const answerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('predicate'),
    name: z.string().nullable(),
    probability,
  }),
  z.object({
    type: z.literal('choice'),
    name: z.string().nullable(),
    choice: z.union([z.string(), z.boolean()]),
    confidence: probability,
    probabilities: z.array(
      z.object({ value: z.union([z.string(), z.boolean()]), probability }),
    ),
  }),
  z.object({
    type: z.literal('score'),
    name: z.string().nullable(),
    score: z.number(),
    confidence: probability,
    probabilities: z.array(z.object({ value: z.number().int(), probability })),
  }),
  z.object({ type: z.literal('refusal'), name: z.string().nullable() }),
])

const responseSchema = z.object({
  model: z.string(),
  answers: z.array(z.unknown()),
  usage: z.object({
    input_tokens: tokenCount,
    input_tokens_details: z
      .object({ cached_tokens: tokenCount.optional() })
      .nullish(),
    output_tokens: tokenCount,
  }),
})

function question(item: tDecisionQuestion) {
  const base = { name: item.name, instructions: item.instructions }
  if (item.kind === 'predicate') return { type: 'predicate', ...base }
  if (item.kind === 'choice')
    return { type: 'choice', ...base, choices: item.choices }
  return { type: 'score', ...base, levels: item.levels }
}

// An answer that isn't for its question (type, name or values) is invalid.
function answerFor(item: tDecisionQuestion, raw: unknown): tDecisionAnswer {
  const invalid = {
    kind: 'refusal',
    name: item.name,
    reason: 'invalid',
  } as const
  const parsed = answerSchema.safeParse(raw)
  if (!parsed.success) return invalid
  const answer = parsed.data
  if (answer.name !== null && answer.name !== item.name) return invalid
  if (answer.type === 'refusal')
    return { kind: 'refusal', name: item.name, reason: 'declined' }
  if (answer.type === 'predicate' && item.kind === 'predicate')
    return {
      kind: 'predicate',
      name: item.name,
      probability: answer.probability,
    }
  if (answer.type === 'choice' && item.kind === 'choice') {
    const values = new Set(item.choices.map((choice) => choice.value))
    if (
      typeof answer.choice !== 'string' ||
      !values.has(answer.choice) ||
      answer.probabilities.some(
        (entry) => typeof entry.value !== 'string' || !values.has(entry.value),
      )
    )
      return invalid
    return {
      kind: 'choice',
      name: item.name,
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: Object.fromEntries(
        item.choices.map(({ value }) => [
          value,
          answer.probabilities.find((entry) => entry.value === value)
            ?.probability ?? 0,
        ]),
      ),
    }
  }
  if (answer.type === 'score' && item.kind === 'score')
    return {
      kind: 'score',
      name: item.name,
      score: answer.score,
      confidence: answer.confidence,
      probabilities: item.levels.map(
        (_, index) =>
          answer.probabilities.find((entry) => entry.value === index)
            ?.probability ?? 0,
      ),
    }
  return invalid
}

export const openAiDecisions: iDecisionProvider = {
  configured() {
    try {
      return Boolean(getOpenAi())
    } catch {
      return false
    }
  },
  async decide(call) {
    const apiKey = getOpenAi().apiKey
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: call.model,
          // Data goes in as JSON text: the shared input is cached across
          // requests once it is 1,024 tokens or more.
          input:
            typeof call.input === 'string'
              ? call.input
              : JSON.stringify(call.input),
          questions: call.questions.map(question),
        }),
        signal: call.signal
          ? AbortSignal.any([call.signal, AbortSignal.timeout(call.timeoutMs)])
          : AbortSignal.timeout(call.timeoutMs),
      })
    } catch {
      throw new DecisionProviderError('network')
    }
    if (!response.ok) throw await httpFailure(response)
    const parsed = responseSchema.safeParse(
      await response.json().catch(() => null),
    )
    if (!parsed.success) throw new DecisionProviderError('invalidResponse')
    const { model, answers, usage } = parsed.data
    return {
      model,
      answers: call.questions.map((item, index) =>
        answerFor(item, answers[index]),
      ),
      usage: {
        inputTokens: usage.input_tokens,
        cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage.output_tokens,
      },
    }
  },
}

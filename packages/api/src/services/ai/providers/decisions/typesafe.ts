import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../../../db'
import { publicRateLimit } from '../../../../db/schema'
import { env, vendorKey } from '../../../../env'
import { ProviderUnconfiguredError } from '../errors'
import {
  DecisionProviderError,
  httpFailure,
  type iDecisionCall,
  type iDecisionProvider,
  type tDecisionAnswer,
  type tDecisionQuestion,
} from './types'

// TypeSafe System One (Jev), optional: DECISION_PROVIDER=typesafe with
// TYPESAFE_API_KEY. https://docs.typesafe.ai/api.md

const defaultEndpoint = 'https://api.typesafe.ai/v1/systemone'
// The account's limits: two requests at a time, at most one start per
// second (no initial burst), shared by every worker through PostgreSQL.
const limiter = { slots: ['jev:slot:0', 'jev:slot:1'], start: 'jev:start' }
const limiterWaitMs = 60_000

async function acquireSlot(leaseMs: number, deadline: number) {
  const bucketStart = new Date(0)
  const keys = [...limiter.slots, limiter.start]
  while (Date.now() < deadline) {
    const reservation = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(728413900)`)
      const now = new Date()
      for (const keyHash of keys)
        await tx
          .insert(publicRateLimit)
          .values({ keyHash, bucketStart, expiresAt: now })
          .onConflictDoNothing()
      const rows = await tx
        .select()
        .from(publicRateLimit)
        .where(
          sql`${publicRateLimit.keyHash} in ('jev:slot:0','jev:slot:1','jev:start')`,
        )
      const slot = rows.find(
        (row) => row.keyHash !== limiter.start && row.expiresAt <= now,
      )
      const start = rows.find((row) => row.keyHash === limiter.start)!
      if (!slot || start.expiresAt > now) return null
      const expiresAt = new Date(Date.now() + leaseMs + 5000)
      await tx
        .update(publicRateLimit)
        .set({ expiresAt })
        .where(eq(publicRateLimit.keyHash, slot.keyHash))
      await tx
        .update(publicRateLimit)
        .set({ expiresAt: new Date(Date.now() + 1000) })
        .where(eq(publicRateLimit.keyHash, limiter.start))
      return { key: slot.keyHash, expiresAt }
    })
    if (reservation)
      return async () => {
        await db
          .update(publicRateLimit)
          .set({ expiresAt: new Date() })
          .where(
            and(
              eq(publicRateLimit.keyHash, reservation.key),
              eq(publicRateLimit.expiresAt, reservation.expiresAt),
            ),
          )
      }
    await Bun.sleep(500)
  }
  // Waiting on our own limiter is like a slow network: try again later.
  throw new DecisionProviderError('network')
}

function question(item: tDecisionQuestion) {
  const base = { instructions: item.instructions }
  if (item.kind === 'predicate') return { type: 'noul', ...base }
  if (item.kind === 'choice')
    return {
      type: 'choice',
      ...base,
      criteria: Object.fromEntries(
        item.choices.map((choice) => [choice.value, choice.description ?? '']),
      ),
    }
  return {
    type: 'score',
    ...base,
    criteria: item.levels.map((level) =>
      level.description ? `${level.label}: ${level.description}` : level.label,
    ),
  }
}

const probability = z.number().min(0).max(1)
const tokenCount = z.number().int().nonnegative()
const answerSchemas = {
  predicate: z.object({ type: z.literal('noul'), noul: probability }),
  choice: z.object({
    type: z.literal('choice'),
    choice: z.string(),
    confidence: probability,
    probabilities: z.record(z.string(), probability),
  }),
  score: z.object({
    type: z.literal('score'),
    score: z.number(),
    confidence: probability,
    probabilities: z.record(z.string(), probability),
  }),
}

function answerFor(item: tDecisionQuestion, raw: unknown): tDecisionAnswer {
  const invalid = {
    kind: 'refusal',
    name: item.name,
    reason: 'invalid',
  } as const
  if (item.kind === 'predicate') {
    const parsed = answerSchemas.predicate.safeParse(raw)
    return parsed.success
      ? { kind: 'predicate', name: item.name, probability: parsed.data.noul }
      : invalid
  }
  if (item.kind === 'choice') {
    const parsed = answerSchemas.choice.safeParse(raw)
    const values = item.choices.map((choice) => choice.value)
    if (
      !parsed.success ||
      !values.includes(parsed.data.choice) ||
      values.some((value) => !(value in parsed.data.probabilities))
    )
      return invalid
    return {
      kind: 'choice',
      name: item.name,
      choice: parsed.data.choice,
      confidence: parsed.data.confidence,
      probabilities: Object.fromEntries(
        values.map((value) => [value, parsed.data.probabilities[value]]),
      ),
    }
  }
  const parsed = answerSchemas.score.safeParse(raw)
  if (!parsed.success) return invalid
  return {
    kind: 'score',
    name: item.name,
    score: parsed.data.score,
    confidence: parsed.data.confidence,
    probabilities: item.levels.map(
      (_, index) => parsed.data.probabilities[String(index)] ?? 0,
    ),
  }
}

export const typeSafeDecisions: iDecisionProvider = {
  configured: () => Boolean(vendorKey('typesafe')),
  async decide(call: iDecisionCall) {
    const apiKey = vendorKey('typesafe')
    if (!apiKey) throw new ProviderUnconfiguredError('typesafe')
    const release = await acquireSlot(
      call.timeoutMs,
      Date.now() + limiterWaitMs,
    )
    let response: Response
    let raw: unknown
    try {
      response = await fetch(env.TYPESAFE_API_URL ?? defaultEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: call.model,
          state: call.input,
          questions: Object.fromEntries(
            call.questions.map((item) => [item.name, question(item)]),
          ),
        }),
        signal: call.signal
          ? AbortSignal.any([call.signal, AbortSignal.timeout(call.timeoutMs)])
          : AbortSignal.timeout(call.timeoutMs),
      })
      // Read the body while the concurrency lease is held.
      if (!response.ok) throw await httpFailure(response)
      raw = await response.json().catch(() => null)
    } catch (error) {
      if (error instanceof DecisionProviderError) throw error
      throw new DecisionProviderError('network')
    } finally {
      await release()
    }
    const parsed = z
      .object({
        // A pinned version must answer as itself.
        model: z.literal(call.model),
        answers: z.record(z.string(), z.unknown()),
        usage: z.object({
          input_tokens: tokenCount,
          output_tokens: tokenCount,
        }),
      })
      .safeParse(raw)
    if (!parsed.success) throw new DecisionProviderError('invalidResponse')
    return {
      model: parsed.data.model,
      answers: call.questions.map((item) =>
        answerFor(item, parsed.data.answers[item.name]),
      ),
      usage: {
        inputTokens: parsed.data.usage.input_tokens,
        cachedInputTokens: 0,
        outputTokens: parsed.data.usage.output_tokens,
      },
    }
  },
}

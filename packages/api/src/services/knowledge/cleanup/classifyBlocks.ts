import { z } from 'zod'
import {
  cleanupLimits,
  jevModel,
  makeJevRequest,
  planJevRequests,
  shrinkJevJob,
  type iJevJob,
} from './jevRequests'
import type { iBlockDecision, iCleanupCheckpoint, iPageBlock } from './types'

const kinds = ['knowledge', 'action', 'noise', 'uncertain'] as const
const probability = z.number().min(0).max(1)
export const decisionSchema = z
  .object({
    type: z.literal('choice'),
    choice: z.enum(kinds),
    confidence: probability,
    probabilities: z.object({
      knowledge: probability,
      action: probability,
      noise: probability,
      uncertain: probability,
    }),
  })
  .refine(
    (a) =>
      // Four independently rounded API probabilities can total 0.98–1.02.
      Math.abs(Object.values(a.probabilities).reduce((s, p) => s + p, 0) - 1) <=
        0.020001 &&
      a.probabilities[a.choice] >=
        Math.max(...Object.values(a.probabilities)) - 0.00001,
  )
const unknownDecision: iBlockDecision = { kind: 'uncertain', confidence: 0 }
export const shouldDiscard = (decision?: iBlockDecision) =>
  decision?.kind === 'noise' && decision.confidence >= 0.95
export class JevDeferred extends Error {
  constructor(readonly retryAt: number) {
    super('Jev retry deferred')
  }
}
interface iOptions {
  checkpoint?: iCleanupCheckpoint
  save: (state: iCleanupCheckpoint) => Promise<void>
  send: (request: ReturnType<typeof makeJevRequest>) => Promise<Response>
  usage?: (
    input: number,
    output: number,
    attempt: number,
    eventId: string,
  ) => Promise<void>
  sleep?: (ms: number) => Promise<unknown>
  now?: () => number
}
export async function classifyPageBlocks(
  page: { url: string; title: string },
  blocks: iPageBlock[],
  options: iOptions,
) {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? Bun.sleep
  const state: iCleanupCheckpoint = options.checkpoint ?? {
    decisions: {},
    attempts: 0,
    activeMs: 0,
    complete: false,
    inputTokens: 0,
    outputTokens: 0,
  }
  const started = now()
  let lastSaved = started
  const save = async () => {
    const at = now()
    state.activeMs += Math.max(0, at - lastSaved)
    lastSaved = at
    await options.save(state)
  }
  const flushUsage = async () => {
    const pending = state.pendingUsage
    if (!pending) return
    await options.usage?.(
      pending.inputTokens,
      pending.outputTokens,
      pending.attempt,
      pending.id,
    )
    delete state.pendingUsage
    await save()
  }
  await flushUsage()
  if (state.retryAt && state.retryAt > now())
    throw new JevDeferred(state.retryAt)
  delete state.retryAt
  let stopped = false
  const available = () =>
    !stopped &&
    state.attempts < cleanupLimits.attempts &&
    state.activeMs + now() - lastSaved < cleanupLimits.activeMs
  const execute = async (
    job: iJevJob,
  ): Promise<Record<string, iBlockDecision>> => {
    if (job.targets.every((id) => state.decisions[id]))
      return Object.fromEntries(
        job.targets.map((id) => [id, state.decisions[id]]),
      )
    const uncertain = () =>
      Object.fromEntries(job.targets.map((id) => [id, unknownDecision]))
    for (let retry = 0; retry < cleanupLimits.retries && available(); retry++) {
      state.attempts++
      await save() // Charge the work budget before making an external request.
      let response: Response
      try {
        response = await options.send(makeJevRequest(page, job))
      } catch {
        if (retry + 1 < cleanupLimits.retries) {
          await sleep(1000 * 2 ** retry)
          continue
        }
        state.reason = 'networkFailure'
        return uncertain()
      }
      if (response.ok) {
        const raw: unknown = await response.json().catch(() => null)
        const parsed = z
          .object({
            model: z.literal(jevModel),
            answers: z.record(z.string(), z.unknown()),
            usage: z.object({
              input_tokens: z.number().int().nonnegative(),
              output_tokens: z.number().int().nonnegative(),
            }),
          })
          .safeParse(raw)
        if (!parsed.success) {
          state.reason = 'invalidResponse'
          return uncertain()
        }
        state.inputTokens += parsed.data.usage.input_tokens
        state.outputTokens += parsed.data.usage.output_tokens
        const decisions = Object.fromEntries(
          job.targets.map((id) => {
            const answer = decisionSchema.safeParse(parsed.data.answers[id])
            if (!answer.success) {
              state.reason = 'invalidDecision'
              return [id, unknownDecision]
            }
            return [
              id,
              { kind: answer.data.choice, confidence: answer.data.confidence },
            ]
          }),
        )
        // Save provider work before accounting. Replaying a pending event uses
        // its stable ID, so an acknowledged insert with a lost response is safe.
        Object.assign(state.decisions, decisions)
        state.pendingUsage = {
          id: crypto.randomUUID(),
          inputTokens: parsed.data.usage.input_tokens,
          outputTokens: parsed.data.usage.output_tokens,
          attempt: state.attempts,
        }
        await save()
        await flushUsage()
        return decisions
      }
      // Read errors only to recognize an explicit context-size rejection; never log bodies.
      const body = (await response.text().catch(() => '')).slice(0, 4000)
      if (
        [400, 413, 422].includes(response.status) &&
        /(?:context|token|input|state).{0,80}(?:too (?:long|large)|exceed|maximum|limit)/iu.test(
          body,
        )
      ) {
        const children = shrinkJevJob(job)
        if (!children.length) {
          state.reason = 'contextLimit'
          return uncertain()
        }
        const results: Record<string, iBlockDecision> = {}
        for (const child of children)
          Object.assign(results, await execute(child))
        return Object.fromEntries(
          job.targets.map((id) => {
            const values = Object.entries(results)
              .filter(([key]) => key === id || key.startsWith(`${id}s`))
              .map(([, decision]) => decision)
            return [
              id,
              values.length && values.every(shouldDiscard)
                ? {
                    kind: 'noise',
                    confidence: Math.min(...values.map((a) => a.confidence)),
                  }
                : unknownDecision,
            ]
          }),
        )
      }
      if ([401, 403].includes(response.status)) {
        state.reason = 'authenticationFailure'
        stopped = true
        return uncertain()
      }
      if (![429, 529].includes(response.status) && response.status < 500) {
        state.reason = 'requestRejected'
        stopped = true
        return uncertain()
      }
      const retryHeader = response.headers.get('retry-after')
      const delay = retryHeader
        ? /^\d+(?:\.\d+)?$/u.test(retryHeader)
          ? Number(retryHeader) * 1000
          : Date.parse(retryHeader) - now()
        : 1000 * 2 ** retry + Math.floor(Math.random() * 250)
      if (Number.isFinite(delay) && delay > 5000) {
        state.retryAt = now() + Math.min(delay, 24 * 60 * 60_000)
        await save()
        throw new JevDeferred(state.retryAt)
      }
      if (retry + 1 === cleanupLimits.retries)
        state.reason = 'providerUnavailable'
      if (retry + 1 < cleanupLimits.retries)
        await sleep(Math.max(250, Number.isFinite(delay) ? delay : 1000))
    }
    return uncertain()
  }
  let planned: ReturnType<typeof planJevRequests>
  try {
    planned = planJevRequests(page, blocks)
  } catch {
    state.reason = 'metadataBudget'
    state.complete = false
    await save()
    return { blocks, checkpoint: state }
  }
  for (const job of planned.jobs) {
    const targets = job.targets.filter((id) => !state.decisions[id])
    if (!targets.length) continue
    if (!available()) {
      state.reason ??= 'workLimit'
      break
    }
    Object.assign(state.decisions, await execute({ ...job, targets }))
    await save()
  }
  const kept = blocks.filter((block) => {
    const fragments = planned.fragments.filter(
      (fragment) => fragment.parentId === block.id,
    )
    return (
      !fragments.length ||
      !fragments.every((fragment) =>
        shouldDiscard(state.decisions[fragment.id]),
      )
    )
  })
  state.complete =
    planned.fragments.every((fragment) => !!state.decisions[fragment.id]) &&
    !state.reason
  // Never replace an existing source with an empty result based solely on model decisions.
  if (!kept.length && blocks.length) {
    state.complete = false
    state.reason = 'emptyCleanupResult'
  }
  await save()
  return { blocks: kept.length ? kept : blocks, checkpoint: state }
}

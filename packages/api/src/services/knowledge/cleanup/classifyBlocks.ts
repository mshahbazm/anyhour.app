import { decisionModels, priceUsd } from '../../../config/models.config'
import {
  decide,
  DecisionDeferred,
  DecisionError,
  type iDecisionUsage,
  type tAnswers,
} from '../../ai/decisions'
import {
  cleanupLimits,
  makeCleanupRequest,
  planCleanupRequests,
  shrinkCleanupJob,
  type iCleanupJob,
  type tCleanupRequest,
} from './cleanupRequests'
import type { iBlockDecision, iCleanupCheckpoint, iPageBlock } from './types'

const unknownDecision: iBlockDecision = { kind: 'uncertain', confidence: 0 }
export const shouldDiscard = (decision?: iBlockDecision) =>
  decision?.kind === 'noise' && decision.confidence >= 0.95
export interface iCleanupResult {
  answers: tAnswers<tCleanupRequest['questions']>
  usage: iDecisionUsage
}
/** One try per request: the retries below are charged to the page's budget. */
const sendOnce = (request: tCleanupRequest): Promise<iCleanupResult> =>
  decide({ ...request, attempts: 1 })
interface iOptions {
  checkpoint?: iCleanupCheckpoint
  save: (state: iCleanupCheckpoint) => Promise<void>
  send?: (request: tCleanupRequest) => Promise<iCleanupResult>
  usage?: (
    usage: iDecisionUsage,
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
  const send = options.send ?? sendOnce
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
      {
        // Checkpoints from before providers were switchable were Jev's.
        provider: pending.provider ?? 'typesafe',
        model: pending.model ?? 'jev-1.13.0',
        inputTokens: pending.inputTokens,
        cachedInputTokens: pending.cachedInputTokens ?? 0,
        outputTokens: pending.outputTokens,
        costUsd:
          pending.costUsd ??
          priceUsd(decisionModels.typesafe['jev-1.13.0'], pending),
      },
      pending.attempt,
      pending.id,
    )
    delete state.pendingUsage
    await save()
  }
  await flushUsage()
  if (state.retryAt && state.retryAt > now())
    throw new DecisionDeferred(state.retryAt)
  delete state.retryAt
  let stopped = false
  const available = () =>
    !stopped &&
    state.attempts < cleanupLimits.attempts &&
    state.activeMs + now() - lastSaved < cleanupLimits.activeMs
  const execute = async (
    job: iCleanupJob,
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
      let result: iCleanupResult
      try {
        result = await send(makeCleanupRequest(page, job))
      } catch (error) {
        const failure =
          error instanceof DecisionError ? error.failure : 'network'
        if (failure === 'network') {
          if (retry + 1 < cleanupLimits.retries) {
            await sleep(1000 * 2 ** retry)
            continue
          }
          state.reason = 'networkFailure'
          return uncertain()
        }
        if (failure === 'invalidResponse') {
          state.reason = 'invalidResponse'
          return uncertain()
        }
        if (failure === 'contextLimit') {
          const children = shrinkCleanupJob(job)
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
        if (failure === 'authentication') {
          state.reason = 'authenticationFailure'
          stopped = true
          return uncertain()
        }
        if (failure === 'rejected') {
          state.reason = 'requestRejected'
          stopped = true
          return uncertain()
        }
        // Busy or failing: wait as asked, or come back later.
        const retryAfter =
          error instanceof DecisionError ? error.retryAfterMs : undefined
        const delay =
          retryAfter ?? 1000 * 2 ** retry + Math.floor(Math.random() * 250)
        if (delay > 5000) {
          state.retryAt = now() + Math.min(delay, 24 * 60 * 60_000)
          await save()
          throw new DecisionDeferred(state.retryAt)
        }
        if (retry + 1 === cleanupLimits.retries)
          state.reason = 'providerUnavailable'
        if (retry + 1 < cleanupLimits.retries) await sleep(Math.max(250, delay))
        continue
      }
      const usage = result.usage
      state.inputTokens += usage.inputTokens
      state.outputTokens += usage.outputTokens
      state.model = usage.model
      const decisions = Object.fromEntries(
        job.targets.map((id, index) => {
          const answer = result.answers[index]
          if (answer?.kind === 'choice' && answer.name === id)
            return [id, { kind: answer.choice, confidence: answer.confidence }]
          // A declined question is uncertain: the block is kept.
          if (answer?.kind !== 'refusal' || answer.reason !== 'declined')
            state.reason = 'invalidDecision'
          return [id, unknownDecision]
        }),
      )
      // Save provider work before accounting. Replaying a pending event uses
      // its stable ID, so an acknowledged insert with a lost response is safe.
      Object.assign(state.decisions, decisions)
      state.pendingUsage = {
        id: crypto.randomUUID(),
        provider: usage.provider,
        model: usage.model,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.costUsd,
        attempt: state.attempts,
      }
      await save()
      await flushUsage()
      return decisions
    }
    return uncertain()
  }
  let planned: ReturnType<typeof planCleanupRequests>
  try {
    planned = planCleanupRequests(page, blocks)
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

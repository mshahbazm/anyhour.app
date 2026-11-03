import { and, eq, inArray } from 'drizzle-orm'
import { whatsappConfig } from '../../config/whatsapp.config'
import { db } from '../../db'
import { whatsappAgent } from '../../db/schema'
import { enqueueWhatsappPoll } from '../queue/boss'
import { agentToken, loadAgent, markBroken, noteError } from './agent'
import { getUpdates, WhatsappError } from './client'
import { handleOwnerMessage } from './ownerMessage'

// One poll loop per agent. WhatsApp has no webhook: the worker runs a
// `whatsapp-poll` job per agent (stately queue, singletonKey = the agent, so
// one runs at a time per agent), which long-polls for about 50 s, then
// queues the next. The maintenance loop re-queues any that went missing.

// continue: queue the next job now. retry: queue it after a pause (rate
// limited, WhatsApp down, another poll running). stop: disconnected or broken.
export type tPollResult = 'continue' | 'retry' | 'stop'

function reportFailure(label: string, error: unknown) {
  console.error(label, error instanceof Error ? error.name : 'Unknown error')
}

export async function pollWhatsapp(
  agentId: string,
  options: { durationMs?: number } = {},
): Promise<tPollResult> {
  const deadline =
    Date.now() + (options.durationMs ?? whatsappConfig.pollJobSeconds * 1000)
  let lastPoll = 0
  do {
    const agent = await loadAgent(agentId)
    if (!agent || agent.status === 'broken') return 'stop'
    const token = await agentToken(agent)
    if (token === null) return 'stop'
    const gap = lastPoll + whatsappConfig.pollSpacingMs - Date.now()
    if (gap > 0) await Bun.sleep(gap)
    const timeout = Math.min(
      whatsappConfig.longPollSeconds,
      Math.max(0, Math.floor((deadline - Date.now()) / 1000) - 3),
    )
    lastPoll = Date.now()
    let updates
    try {
      updates = await getUpdates(token, agent.pollOffset, timeout)
    } catch (error) {
      if (!(error instanceof WhatsappError)) throw error
      if (error.failure === 'unauthorized') {
        await markBroken(agentId, error.message)
        return 'stop'
      }
      if (error.failure !== 'busy') await noteError(agentId, error.message)
      return 'retry'
    }
    // Only for the key this loop started with: a reconnect starts over.
    const sameKey = and(
      eq(whatsappAgent.id, agentId),
      eq(whatsappAgent.tokenFingerprint, agent.tokenFingerprint),
    )
    await db
      .update(whatsappAgent)
      .set({ lastPolledAt: new Date() })
      .where(sameKey)
    if (!updates) continue
    for (const message of updates.messages) {
      // Reloaded per message: the first one links the owner, and the owner
      // may disconnect meanwhile.
      const current = await loadAgent(agentId)
      if (
        !current ||
        current.status === 'broken' ||
        current.tokenFingerprint !== agent.tokenFingerprint
      )
        return 'stop'
      try {
        await handleOwnerMessage(current, message)
      } catch (error) {
        // Handled at most once: a failure is logged, not replayed.
        reportFailure('WhatsApp message handling failed', error)
      }
    }
    if (updates.nextOffset !== null)
      await db
        .update(whatsappAgent)
        .set({ pollOffset: updates.nextOffset })
        .where(sameKey)
  } while (Date.now() + 5_000 < deadline)
  return 'continue'
}

// The worker's job: poll, then queue the next round.
export async function runWhatsappPollJob(agentId: string) {
  const result = await pollWhatsapp(agentId)
  if (result === 'continue') await enqueueWhatsappPoll(agentId)
  else if (result === 'retry')
    await enqueueWhatsappPoll(agentId, whatsappConfig.pollRetrySeconds)
}

// Every minute: every connected agent has a poll job queued or running. The
// stately queue drops the extra ones.
export async function ensureWhatsappPollers() {
  const agents = await db
    .select({ id: whatsappAgent.id })
    .from(whatsappAgent)
    .where(inArray(whatsappAgent.status, ['waiting_for_hi', 'linked']))
  for (const agent of agents) await enqueueWhatsappPoll(agent.id)
  return agents.length
}

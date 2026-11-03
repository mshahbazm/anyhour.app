import { PgBoss } from 'pg-boss'
import { env } from '../../env'
import { knowledgeConfig } from '../../config/knowledge.config'
import { knowledgeOverviewLimits } from '../../config/knowledgeOverview.config'

let bossPromise: Promise<PgBoss> | undefined

export function getBoss() {
  bossPromise ??= (async () => {
    const boss = new PgBoss(env.DATABASE_URL)
    await boss.start()
    await boss.createQueue('discover-source')
    await boss.createQueue('index-source')
    await boss.createQueue('start-crawl')
    await boss.createQueue('prepare-page')
    await boss.createQueue('embed-page')
    await boss.createQueue('group-website')
    await boss.createQueue('recheck-archived-page')
    // One waiting and one running rebuild per bot: bursts of changes collapse.
    await boss.createQueue('refresh-overview', { policy: 'stately' })
    // Opening hours from Your business: one waiting and one running per
    // workspace, so a burst of changes reads them once.
    await boss.createQueue('business-hours', { policy: 'stately' })
    await boss.createQueue('lead-captured')
    // Contact memory after a conversation ends (services/contacts/memory.ts).
    await boss.createQueue('contact-facts')
    // WhatsApp owner alerts: one poll loop per agent (the API allows one
    // poll at a time), plus at most one queued behind it.
    await boss.createQueue('whatsapp-poll', { policy: 'stately' })
    // Chat app messages (docs/teamChat.md): one active per person and
    // employee so their messages are answered in order, any number waiting.
    await boss.createQueue('team-chat', { policy: 'singleton' })
    return boss
  })().catch((error: unknown) => {
    bossPromise = undefined
    throw error
  })
  return bossPromise
}

// Rebuild a bot's overview once its knowledge settles after a change.
export async function enqueueOverviewRefresh(assistantId: string) {
  const boss = await getBoss()
  await boss.send(
    'refresh-overview',
    { assistantId },
    {
      singletonKey: assistantId,
      startAfter: knowledgeOverviewLimits.settleSeconds,
      retryLimit: 2,
      retryDelay: 120,
    },
  )
}

// Reads the workspace's opening hours once its knowledge settles after a
// change (services/workspace/hoursFromKnowledge.ts).
export async function enqueueBusinessHours(organizationId: string) {
  const boss = await getBoss()
  await boss.send(
    'business-hours',
    { organizationId },
    {
      singletonKey: organizationId,
      startAfter: 30,
      retryLimit: 1,
      retryDelay: 120,
    },
  )
}

export async function enqueueArchiveRecheck(
  sourceId: string,
  archivedAt: Date,
  checkAt: Date,
) {
  const boss = await getBoss()
  await boss.send(
    'recheck-archived-page',
    {
      sourceId,
      archivedAt: archivedAt.toISOString(),
      checkAt: checkAt.toISOString(),
    },
    {
      startAfter: Math.max(
        0,
        Math.ceil((checkAt.getTime() - Date.now()) / 1000),
      ),
      singletonKey: `${sourceId}:${archivedAt.toISOString()}:${checkAt.toISOString()}`,
      // Failed pg-boss jobs also occupy their singleton window. Keep it short
      // so the durable deadline can recover delivery after retries exhaust.
      singletonSeconds: 60,
      retryLimit: 3,
      retryDelay: 600,
    },
  )
}

export async function enqueueCrawlStart(runId: string, sourceId: string) {
  const boss = await getBoss()
  await boss.send(
    'start-crawl',
    { runId, sourceId },
    {
      retryLimit: knowledgeConfig.queueRetries,
      retryDelay: knowledgeConfig.queueRetryDelaySeconds,
      singletonKey: runId,
      singletonSeconds: 60,
    },
  )
}

export async function enqueuePreparePage(
  runId: string,
  sourceId: string,
  delaySeconds = 0,
) {
  const boss = await getBoss()
  await boss.send(
    'prepare-page',
    { runId, sourceId },
    {
      retryLimit: knowledgeConfig.queueRetries,
      retryDelay: knowledgeConfig.queueRetryDelaySeconds,
      singletonKey: `${runId}:${sourceId}`,
      singletonSeconds: 60,
      ...(delaySeconds ? { startAfter: delaySeconds } : {}),
    },
  )
}

export async function enqueueGroupWebsite(runId: string) {
  const boss = await getBoss()
  await boss.send(
    'group-website',
    { runId },
    {
      retryLimit: knowledgeConfig.queueRetries,
      retryDelay: knowledgeConfig.queueRetryDelaySeconds,
      singletonKey: runId,
      singletonSeconds: 30,
    },
  )
}

export async function enqueueEmbedPage(runId: string, sourceId: string) {
  const boss = await getBoss()
  await boss.send(
    'embed-page',
    { runId, sourceId },
    {
      retryLimit: knowledgeConfig.queueRetries,
      retryDelay: knowledgeConfig.queueRetryDelaySeconds,
      singletonKey: `${runId}:${sourceId}`,
      singletonSeconds: 60,
    },
  )
}

export async function enqueueDiscovery(runId: string, sourceId: string) {
  const boss = await getBoss()
  await boss.send(
    'discover-source',
    { runId, sourceId },
    {
      retryLimit: knowledgeConfig.queueRetries,
      retryDelay: knowledgeConfig.queueRetryDelaySeconds,
      singletonKey: runId,
      singletonSeconds: 60,
    },
  )
}

export async function enqueueIndex(runId: string, sourceId: string) {
  const boss = await getBoss()
  return boss.send(
    'index-source',
    { runId, sourceId },
    {
      retryLimit: knowledgeConfig.queueRetries,
      retryDelay: knowledgeConfig.queueRetryDelaySeconds,
      singletonKey: `${runId}:${sourceId}`,
      singletonSeconds: 60,
    },
  )
}

// Qualifies a new lead, then alerts the owners.
// Retried twice when qualification is temporarily unavailable.
export async function enqueueLeadCaptured(leadId: string) {
  const boss = await getBoss()
  await boss.send(
    'lead-captured',
    { leadId },
    { retryLimit: 2, retryDelay: 60, retryBackoff: true },
  )
}

// Wakes the WhatsApp poll loop for one agent. The stately queue keeps one
// running and one waiting per agent; extra sends are dropped.
export async function enqueueWhatsappPoll(agentId: string, delaySeconds = 0) {
  const boss = await getBoss()
  await boss.send(
    'whatsapp-poll',
    { agentId },
    {
      singletonKey: agentId,
      retryLimit: 1,
      retryDelay: 30,
      ...(delaySeconds > 0 ? { startAfter: Math.ceil(delaySeconds) } : {}),
    },
  )
}

// A message from a chat app for the owner assistant: a WhatsApp message row,
// or a stored Slack event. `key` is the person and app, so their
// messages run one at a time. Not retried: a reply that may have half run
// is never replayed.
export type tTeamChatJob =
  | { source: 'whatsapp'; agentId: string; messageId: string }
  | { source: 'connection'; eventId: string }

export async function enqueueTeamChat(job: tTeamChatJob, key: string) {
  const boss = await getBoss()
  await boss.send('team-chat', job, { singletonKey: key, retryLimit: 0 })
}

// Remembers durable facts about a conversation's contact once it ends. The
// key names that end, so a repeat send while one is queued is dropped; the
// job itself skips an end it already extracted.
export async function enqueueContactFacts(
  conversationId: string,
  closedAt: string,
) {
  const boss = await getBoss()
  await boss.send(
    'contact-facts',
    { conversationId, closedAt },
    {
      singletonKey: `${conversationId}:${closedAt}`,
      // contactFactsRetries in services/contacts/memory.ts.
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
    },
  )
}

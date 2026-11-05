import { knowledgeConfig } from './config/knowledge.config'
import { groupWebsite } from './services/knowledge/groupWebsite'
import {
  recheckArchivedPage,
  recoverArchiveRechecks,
} from './services/knowledge/archivedPages'
import { sweepEmbeddingCheckpoints } from './services/knowledge/embeddingCheckpoints'
import { sweepStagedPages } from './services/knowledge/staging'
import {
  repairActiveRunCounters,
  recoverIndexRuns,
} from './services/knowledge/runOrchestrator'
import {
  discoverSource,
  indexSource,
  handleDiscoveryFailure,
} from './services/knowledge/indexer'
import { refreshDueSources } from './services/knowledge/refreshScheduling'
import { sweepStorageCleanup } from './services/knowledge/storageCleanup'
import { cleanupOrphanSharedBlocks } from './services/knowledge/sharedBlockCleanup'
import { cleanupExpiredRateLimits } from './services/http/rateLimitCleanup'
import { getBoss } from './services/queue/boss'
import { reportWorkerAlive } from './services/queue/workerHealth'
import { handleCrawlFailure, startCrawl } from './services/knowledge/crawl'
import { embedPage } from './services/knowledge/embedPage'
import { preparePage } from './services/knowledge/preparePage'
import { refreshOverview } from './services/knowledge/overview/refreshOverview'
import { handleLeadCaptured } from './services/leads/captured'
import { findBusinessHours } from './services/workspace/hoursFromKnowledge'
import { findContactDetails } from './services/workspace/contactsFromKnowledge'
import { closeIdleConversations } from './services/chat/idleConversations'
import { runContactFactsJob } from './services/contacts/memory'
import { whatsappConfig } from './config/whatsapp.config'
import {
  ensureWhatsappPollers,
  runWhatsappPollJob,
} from './services/whatsapp/poller'
import type { tTeamChatJob } from './services/queue/boss'
import { runTeamChatJob } from './services/teamChat/job'
import { pruneConnectionEvents } from './services/connections/events'

const boss = await getBoss()

await boss.work<{ sourceId: string; archivedAt: string; checkAt: string }>(
  'recheck-archived-page',
  async ([job]) => {
    await recheckArchivedPage(
      job.data.sourceId,
      job.data.archivedAt,
      job.data.checkAt,
    )
  },
)

await boss.work<{ runId: string; sourceId: string }>(
  'discover-source',
  async ([job]) => {
    try {
      await discoverSource(job.data.runId, job.data.sourceId)
    } catch (error) {
      await handleDiscoveryFailure(
        job.data.runId,
        job.data.sourceId,
        error,
        job.retryCount,
      )
      throw error
    }
  },
)

await boss.work<{ runId: string; sourceId: string }>(
  'start-crawl',
  async ([job]) => {
    try {
      await startCrawl(job.data.runId, job.data.sourceId)
    } catch (error) {
      await handleCrawlFailure(job.data.runId, error, job.retryCount)
      throw error
    }
  },
)

// Pages of one website are read side by side: as many as the browser opens
// tabs at once (services/knowledge/pageLoaders/).
await boss.work<{ runId: string; sourceId: string }>(
  'prepare-page',
  { localConcurrency: knowledgeConfig.pagesAtOnce },
  async ([job]) => {
    await preparePage(job.data.runId, job.data.sourceId)
  },
)

await boss.work<{ runId: string }>('group-website', async ([job]) => {
  await groupWebsite(job.data.runId)
})

await boss.work<{ runId: string; sourceId: string }>(
  'embed-page',
  { localConcurrency: knowledgeConfig.pagesAtOnce },
  async ([job]) => {
    await embedPage(job.data.runId, job.data.sourceId)
  },
)

await boss.work<{ runId: string; sourceId: string }>(
  'index-source',
  async ([job]) => {
    await indexSource(job.data.runId, job.data.sourceId)
  },
)

await boss.work<{ assistantId: string }>('refresh-overview', async ([job]) => {
  await refreshOverview(job.data.assistantId)
})

// Opening hours from Your business. A failure is logged and retried once;
// it never touches reading or notes.
await boss.work<{ organizationId: string }>('business-hours', async ([job]) => {
  await findBusinessHours(job.data.organizationId)
})

// Contact details from Your business, the same way.
await boss.work<{ organizationId: string }>(
  'contact-details',
  async ([job]) => {
    await findContactDetails(job.data.organizationId)
  },
)

await boss.work<{ agentId?: string }>(
  'whatsapp-poll',
  { localConcurrency: whatsappConfig.pollConcurrency },
  async ([job]) => {
    // Jobs queued before agents were per person carry no agent; the
    // maintenance loop queues the right ones.
    if (job.data.agentId) await runWhatsappPollJob(job.data.agentId)
  },
)

// Messages from chat apps for the owner assistant (docs/teamChat.md).
await boss.work<tTeamChatJob>(
  'team-chat',
  { localConcurrency: 10 },
  async ([job]) => {
    await runTeamChatJob(job.data)
  },
)

await boss.work<{ leadId: string }>('lead-captured', async ([job]) => {
  await handleLeadCaptured(job.data.leadId, job.retryCount)
})

await boss.work<{ conversationId: string; closedAt: string }>(
  'contact-facts',
  async ([job]) => {
    await runContactFactsJob(job.data, job.retryCount)
  },
)

function reportFailure(label: string, error: unknown) {
  console.error(label, error instanceof Error ? error.name : 'Unknown error')
}

let maintaining = false
async function runMaintenance() {
  if (maintaining) return
  maintaining = true
  try {
    const tasks: [string, () => Promise<unknown>][] = [
      ['Scheduled refresh failed', refreshDueSources],
      ['Archive recheck recovery failed', recoverArchiveRechecks],
      ['Staging sweep failed', sweepStagedPages],
      ['Embedding checkpoint cleanup failed', sweepEmbeddingCheckpoints],
      ['Upload cleanup failed', sweepStorageCleanup],
      ['Shared knowledge cleanup failed', cleanupOrphanSharedBlocks],
      ['Rate-limit cleanup failed', cleanupExpiredRateLimits],
      ['Idle conversation sweep failed', closeIdleConversations],
      ['WhatsApp poller check failed', ensureWhatsappPollers],
      ['Connection event pruning failed', pruneConnectionEvents],
    ]
    await Promise.all(
      tasks.map(async ([label, work]) => {
        try {
          await work()
        } catch (error) {
          reportFailure(label, error)
        }
      }),
    )
  } finally {
    maintaining = false
  }
}

let recovering = false
async function runRecovery() {
  if (recovering) return
  recovering = true
  try {
    await repairActiveRunCounters().catch((error: unknown) =>
      reportFailure('Index-run counter repair failed', error),
    )
    await recoverIndexRuns().catch((error: unknown) =>
      reportFailure('Index-run recovery failed', error),
    )
  } finally {
    recovering = false
  }
}

// Lets the app tell owners when reading is paused because this isn't running.
const beat = () =>
  reportWorkerAlive().catch((error: unknown) =>
    reportFailure('Worker heartbeat failed', error),
  )
await beat()
const heartbeatTimer = setInterval(() => void beat(), 30_000)

await runRecovery()
const refreshTimer = setInterval(() => {
  void runMaintenance()
}, 60_000)
const recoveryTimer = setInterval(() => {
  void runRecovery()
}, 60_000)

process.on('SIGTERM', async () => {
  clearInterval(heartbeatTimer)
  clearInterval(refreshTimer)
  clearInterval(recoveryTimer)
  await boss.stop()
  process.exit(0)
})

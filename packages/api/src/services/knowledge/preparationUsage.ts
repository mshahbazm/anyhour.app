import { db } from '../../db'
import { aiUsageEvent } from '../../db/schema'
import { env } from '../../env'
import { costUsd, languageModels, llmTasks } from '../../config/models.config'
import type { iUsageTokens } from '../../config/models.config'
import type { iDecisionUsage } from '../ai/decisions'
import type { iKnowledgeOwner } from './owner'
import { sourceUsageContext } from './sourceUsageContext'

// Usage of reading one page, recorded under a stable id so a replayed
// checkpoint never counts twice: cleanup as its decision provider reported
// it, the page profile priced from the language model's config.
export async function sourcePreparationUsage(
  owner: iKnowledgeOwner,
  sourceId: string,
) {
  const context = sourceUsageContext(owner, sourceId)
  async function record(
    kind: 'cleanup',
    usage: iDecisionUsage,
    eventId?: string,
  ): Promise<void>
  async function record(
    kind: 'pageProfile',
    usage: iUsageTokens,
    eventId?: string,
  ): Promise<void>
  async function record(
    kind: 'cleanup' | 'pageProfile',
    usage: iUsageTokens | iDecisionUsage,
    eventId?: string,
  ) {
    if (!(usage.inputTokens || usage.outputTokens)) return
    const task = llmTasks.pageProfile as {
      model: keyof typeof languageModels
      serviceTier?: 'flex'
    }
    const served =
      'provider' in usage
        ? usage
        : {
            provider: env.LLM_PROVIDER,
            model: languageModels[task.model].id,
            costUsd: costUsd(task.model, usage, task.serviceTier),
          }
    await db
      .insert(aiUsageEvent)
      .values({
        ...context,
        ...(eventId ? { id: eventId } : {}),
        kind,
        provider: served.provider,
        model: served.model,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens ?? 0,
        outputTokens: usage.outputTokens,
        costUsd: served.costUsd,
      })
      .onConflictDoNothing({ target: aiUsageEvent.id })
  }
  return record
}

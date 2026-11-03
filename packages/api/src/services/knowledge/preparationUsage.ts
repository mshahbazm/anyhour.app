import { knowledgeConfig } from '../../config/knowledge.config'
import { db } from '../../db'
import { aiUsageEvent } from '../../db/schema'
import { jevModel } from './cleanup/jevRequests'
import { costUsd, languageModels, llmTasks } from '../../config/models.config'
import type { iKnowledgeOwner } from './owner'
import { sourceUsageContext } from './sourceUsageContext'

export async function sourcePreparationUsage(
  owner: iKnowledgeOwner,
  sourceId: string,
) {
  const context = sourceUsageContext(owner, sourceId)
  return async (
    kind: 'cleanup' | 'pageProfile',
    inputTokens: number,
    outputTokens: number,
    eventId?: string,
  ) => {
    if (!(inputTokens || outputTokens)) return
    const pricing = knowledgeConfig.preparationPricing.cleanup
    const profileModel = llmTasks.pageProfile.model
    await db
      .insert(aiUsageEvent)
      .values({
        ...context,
        ...(eventId ? { id: eventId } : {}),
        kind,
        provider: kind === 'cleanup' ? 'typesafe' : 'openai',
        model: kind === 'cleanup' ? jevModel : languageModels[profileModel].id,
        inputTokens,
        outputTokens,
        costUsd:
          kind === 'cleanup'
            ? (
                (inputTokens * pricing.inputCostPerMillion +
                  outputTokens * pricing.outputCostPerMillion) /
                1_000_000
              ).toFixed(10)
            : costUsd(profileModel, inputTokens, outputTokens),
      })
      .onConflictDoNothing({ target: aiUsageEvent.id })
  }
}

import { db } from '../../db'
import { aiUsageEvent } from '../../db/schema'
import { embeddingModel } from '../../config/models.config'
import type { iKnowledgeOwner } from './owner'
import { sourceUsageContext } from './sourceUsageContext'

type tUsageDatabase =
  typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

interface iEmbeddingUsageContext {
  organizationId: string
  assistantId?: string | null
  sourceId?: string
  conversationId?: string
}

export function embeddingUsageRecorder(context: iEmbeddingUsageContext) {
  // Provider usage survives a rejected publication or a later batch failure.
  return async (tokens: number, database: tUsageDatabase = db) => {
    await database.insert(aiUsageEvent).values({
      ...context,
      kind: 'embedding',
      provider: 'openai',
      model: embeddingModel.id,
      inputTokens: tokens,
      costUsd: (
        (tokens * embeddingModel.inputCostPerMillion) /
        1_000_000
      ).toFixed(10),
    })
  }
}

export async function sourceEmbeddingUsage(
  owner: iKnowledgeOwner,
  sourceId: string,
) {
  return embeddingUsageRecorder(sourceUsageContext(owner, sourceId))
}

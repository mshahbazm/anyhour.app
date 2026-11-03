import { createHash } from 'node:crypto'
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import {
  knowledgeSharedBlock,
  knowledgeSharedBlockSource,
} from '../../db/schema'
import { embeddingModel } from '../../config/models.config'
import { embedTexts, type iEmbeddingOptions } from './embedding'
import { chunkText } from './chunk'
import type { iSharedText } from './cleanup/types'
import { ownerOf } from './owner'
import type { iKnowledgeOwner } from './owner'

export async function prepareSharedContent(
  owner: iKnowledgeOwner,
  websiteId: string,
  blocks: iSharedText[],
  options: iEmbeddingOptions,
) {
  const candidates = new Map<string, string>()
  for (const block of blocks)
    for (const text of chunkText(block.text, 'Shared website information')) {
      const id = createHash('sha256')
        .update(`${websiteId}\n${block.key}\n${text}`)
        .digest('hex')
      candidates.set(id, text)
    }
  const ids = [...candidates.keys()]
  const records: (typeof knowledgeSharedBlock.$inferInsert)[] = []
  for (let start = 0; start < ids.length; start += 1000)
    records.push(
      ...(await db
        .select()
        .from(knowledgeSharedBlock)
        .where(
          inArray(knowledgeSharedBlock.id, ids.slice(start, start + 1000)),
        )),
    )
  const existingIds = new Set(records.map((record) => record.id))
  const missing = [...candidates].filter(([id]) => !existingIds.has(id))
  const result = await embedTexts(
    missing.map(([, text]) => text),
    options,
  )
  records.push(
    ...missing.map(([id, text], index) => ({
      id,
      ...ownerOf(owner),
      websiteId,
      text,
      embedding: result.vectors[index],
      embeddingModel: embeddingModel.id,
    })),
  )
  return { ids, tokens: result.tokens, records }
}
export async function readSourceSharedText(sourceId: string) {
  return db
    .select({ text: knowledgeSharedBlock.text })
    .from(knowledgeSharedBlockSource)
    .innerJoin(
      knowledgeSharedBlock,
      eq(knowledgeSharedBlock.id, knowledgeSharedBlockSource.blockId),
    )
    .where(eq(knowledgeSharedBlockSource.sourceId, sourceId))
    .orderBy(asc(knowledgeSharedBlock.id))
}

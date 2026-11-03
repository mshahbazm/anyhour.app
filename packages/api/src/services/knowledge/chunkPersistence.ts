import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { knowledgeChunk } from '../../db/schema'
import { embeddingModel } from '../../config/models.config'
import { ownerOf } from './owner'
import type { iKnowledgeOwner } from './owner'
import { profileChunkPosition } from './profileChunk'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function replaceContentChunks(
  tx: tTransaction,
  owner: iKnowledgeOwner,
  sourceId: string,
  texts: string[],
  vectors: number[][],
) {
  await tx
    .delete(knowledgeChunk)
    .where(
      and(
        eq(knowledgeChunk.sourceId, sourceId),
        eq(knowledgeChunk.kind, 'content'),
      ),
    )
  if (texts.length)
    await tx.insert(knowledgeChunk).values(
      texts.map((text, position) => ({
        ...ownerOf(owner),
        sourceId,
        position,
        text,
        embedding: vectors[position],
        embeddingModel: embeddingModel.id,
      })),
    )
}

export async function writeProfileChunk(
  tx: tTransaction,
  owner: iKnowledgeOwner,
  sourceId: string,
  text: string | null,
  vector?: number[],
) {
  if (!text) {
    await tx
      .delete(knowledgeChunk)
      .where(
        and(
          eq(knowledgeChunk.sourceId, sourceId),
          eq(knowledgeChunk.kind, 'pageProfile'),
        ),
      )
    return
  }
  if (!vector) throw new Error('Profile embedding is missing')
  const record = {
    ...ownerOf(owner),
    sourceId,
    position: profileChunkPosition,
    kind: 'pageProfile' as const,
    text,
    embedding: vector,
    embeddingModel: embeddingModel.id,
  }
  await tx
    .insert(knowledgeChunk)
    .values(record)
    .onConflictDoUpdate({
      target: [knowledgeChunk.sourceId, knowledgeChunk.position],
      set: {
        text,
        embedding: vector,
        embeddingModel: embeddingModel.id,
        kind: 'pageProfile',
      },
    })
}

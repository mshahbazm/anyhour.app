import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { knowledgeChunk, knowledgeSource } from '../../db/schema'
import { writeProfileChunk } from './chunkPersistence'
import { sourceEmbeddingUsage } from './embeddingUsage'
import { embedTexts } from './embedding'
import { buildProfileChunk } from './profileChunk'
import { searchableSource } from './sourceEligibility'
import { ownerOf } from './owner'

// Used for existing profiles and HTTP 304 responses. No crawl or LLM generation.
export async function syncStoredProfileChunk(sourceId: string) {
  const [source] = await db
    .select({
      organizationId: knowledgeSource.organizationId,
      title: knowledgeSource.title,
      pageProfile: knowledgeSource.pageProfile,
      updatedAt: knowledgeSource.updatedAt,
    })
    .from(knowledgeSource)
    .where(and(eq(knowledgeSource.id, sourceId), searchableSource()))
    .limit(1)
  if (!source) return false
  const text = buildProfileChunk(source.title, source.pageProfile)
  const [previous] = await db
    .select({ text: knowledgeChunk.text })
    .from(knowledgeChunk)
    .where(
      and(
        eq(knowledgeChunk.sourceId, sourceId),
        eq(knowledgeChunk.kind, 'pageProfile'),
      ),
    )
    .limit(1)
  if (text === (previous?.text ?? null)) return false
  const onUsage = await sourceEmbeddingUsage(ownerOf(source), sourceId)
  const { vectors } = await embedTexts(text ? [text] : [], { onUsage })
  return db.transaction(async (tx) => {
    // A refresh/archive can happen while the embedding request is in flight.
    // Never install an embedding for a superseded profile or an archived page.
    const [current] = await tx
      .select({ updatedAt: knowledgeSource.updatedAt })
      .from(knowledgeSource)
      .where(and(eq(knowledgeSource.id, sourceId), searchableSource()))
      .for('update')
    if (!current || current.updatedAt.getTime() !== source.updatedAt.getTime())
      return false
    await writeProfileChunk(tx, ownerOf(source), sourceId, text, vectors[0])
    return true
  })
}

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../db'
import {
  assistant,
  connection,
  indexRun,
  knowledgeChunk,
  knowledgeCorrection,
  knowledgeSharedBlock,
  knowledgeSharedBlockSource,
  knowledgeSource,
} from '../../db/schema'
import type {
  createSourceSchema,
  updateSourceSchema,
} from '../../schemas/assistant.schema'
import { ApiError } from '../http/apiError'
import { ownWebsiteOrigin } from '../widget/ownWebsite'
import { forgetSiteSettings } from '../widget/site'
import {
  closeActiveRuns,
  createRunRequest,
  dispatchRunRequest,
  queueRun,
} from './runRequests'
import { reconcileWebsitePaths } from './sourcePaths'
import { recordStorageCleanup, sweepStorageCleanup } from './storageCleanup'
import { deleteUpload, storeUpload } from './upload'
import { normalizeUrl } from './web'
import { deleteOrphanSharedBlocks } from './sharedBlockCleanup'
import { lockOwner, ownedBy, ownerOf } from './owner'
import { findWorkspaceAi } from '../assistants/workspaceAi'
import type { iKnowledgeOwner } from './owner'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// The first website the owner shares is almost always their own, so the chat
// may load there: the AI answers it, unless it already has a website. They
// can remove it from the website's channel.
async function allowOwnWebsite(
  tx: tTransaction,
  owner: iKnowledgeOwner,
  origin: string,
) {
  const ai = await findWorkspaceAi(owner.organizationId, tx)
  if (!ai) return []
  const updated = await tx
    .update(assistant)
    .set({ allowedOrigins: [origin] })
    .where(
      and(
        eq(assistant.id, ai.id),
        sql`${assistant.allowedOrigins} = '[]'::jsonb`,
      ),
    )
    .returning({ id: assistant.id })
  // The site becomes a website channel, unless it already is one.
  if (updated[0])
    await tx
      .insert(connection)
      .values({
        organizationId: owner.organizationId,
        provider: 'website',
        externalAccountId: origin,
        assistantId: ai.id,
      })
      .onConflictDoNothing()
  return updated.map((row) => row.id)
}

export async function createKnowledgeSource(
  owner: iKnowledgeOwner,
  input: z.infer<typeof createSourceSchema>,
) {
  const url = normalizeUrl(input.url)
  let allowed: string[] = []
  const result = await db.transaction(async (tx) => {
    await lockOwner(tx, owner)
    const origin =
      input.kind === 'publicDocument' ? null : ownWebsiteOrigin(url)
    if (origin) allowed = await allowOwnWebsite(tx, owner, origin)
    if (input.kind === 'website') {
      const roots = await tx
        .select({ inputUrl: knowledgeSource.inputUrl })
        .from(knowledgeSource)
        .where(
          and(
            ownedBy(knowledgeSource, owner),
            eq(knowledgeSource.kind, 'website'),
          ),
        )
      if (
        roots.some(
          (root) =>
            root.inputUrl &&
            new URL(root.inputUrl).origin === new URL(url).origin,
        )
      )
        throw new ApiError(
          409,
          'overlapping_site',
          'This website is already added',
        )
    }
    const [created] = await tx
      .insert(knowledgeSource)
      .values({
        ...ownerOf(owner),
        kind: input.kind,
        inputUrl: url,
        canonicalUrl: input.kind === 'website' ? null : url,
        isPinned: input.kind !== 'website',
        includePaths: input.includePaths,
        excludePaths: input.excludePaths,
        discoveredVia: 'manual',
      })
      .onConflictDoNothing()
      .returning()
    if (!created)
      throw new ApiError(409, 'duplicate_source', 'This URL is already indexed')
    return {
      source: created,
      indexRun: await createRunRequest(tx, owner, created.id, 'created'),
    }
  })
  for (const id of allowed) forgetSiteSettings(id)
  await dispatchRunRequest(result.indexRun.id)
  return result
}

export async function createUploadSource(owner: iKnowledgeOwner, file: File) {
  const stored = await storeUpload(file, owner)
  let result: {
    source: typeof knowledgeSource.$inferSelect
    indexRun: typeof indexRun.$inferSelect
  }
  try {
    result = await db.transaction(async (tx) => {
      await lockOwner(tx, owner)
      const [created] = await tx
        .insert(knowledgeSource)
        .values({
          ...ownerOf(owner),
          kind: 'upload',
          objectKey: stored.objectKey,
          fileName: file.name,
          mimeType: stored.mimeType,
          fileSize: file.size,
          title: file.name,
          discoveredVia: 'upload',
        })
        .returning()
      return {
        source: created,
        indexRun: await createRunRequest(tx, owner, created.id, 'created'),
      }
    })
  } catch (error) {
    // If persistence failed, retain a retryable cleanup intent where possible.
    // Direct deletion also works when the database itself is unavailable.
    try {
      await recordStorageCleanup(db, [stored.objectKey])
      await sweepStorageCleanup([stored.objectKey])
    } catch {
      await deleteUpload(stored.objectKey).catch(() => {
        console.error('Upload rollback cleanup failed')
      })
    }
    throw error
  }
  await dispatchRunRequest(result.indexRun.id)
  return result
}

export async function updateKnowledgeSource(
  owner: iKnowledgeOwner,
  sourceId: string,
  input: z.infer<typeof updateSourceSchema>,
) {
  const { updated, widened } = await applySourceUpdate(owner, sourceId, input)
  // A page deleted from a website kept no content; including it again reads
  // it. A website whose rules now allow more reads again at once: pages the
  // crawler skipped were never found, so a refresh is what brings them back.
  if (
    (input.isIncluded && updated.kind === 'webPage' && !updated.contentHash) ||
    widened
  )
    await queueRun(owner, sourceId, 'manual')
  return updated
}

// Whether new path rules may allow pages the old ones skipped: an exclude
// rule removed or changed, or an include rule removed.
function rulesWidened(
  before: { includePaths: string[]; excludePaths: string[] },
  after: { includePaths: string[]; excludePaths: string[] },
) {
  const removed = (from: string[], to: string[]) =>
    from.some((rule) => !to.includes(rule))
  return (
    removed(before.excludePaths, after.excludePaths) ||
    (before.includePaths.length > 0 &&
      (after.includePaths.length === 0 ||
        removed(before.includePaths, after.includePaths)))
  )
}

function applySourceUpdate(
  owner: iKnowledgeOwner,
  sourceId: string,
  input: z.infer<typeof updateSourceSchema>,
) {
  return db.transaction(async (tx) => {
    await lockOwner(tx, owner)
    const [before] = await tx
      .select({
        includePaths: knowledgeSource.includePaths,
        excludePaths: knowledgeSource.excludePaths,
      })
      .from(knowledgeSource)
      .where(
        and(eq(knowledgeSource.id, sourceId), ownedBy(knowledgeSource, owner)),
      )
      .for('update')
    const [updated] = await tx
      .update(knowledgeSource)
      .set(input)
      .where(
        and(eq(knowledgeSource.id, sourceId), ownedBy(knowledgeSource, owner)),
      )
      .returning()
    if (!updated) throw new ApiError(404, 'source_missing', 'Source not found')
    if (
      updated.kind === 'website' &&
      (input.includePaths !== undefined || input.excludePaths !== undefined)
    )
      await reconcileWebsitePaths(updated.id, tx)
    return {
      updated,
      widened:
        updated.kind === 'website' &&
        Boolean(before) &&
        rulesWidened(before, updated),
    }
  })
}

async function preserveDetachedKnowledge(
  tx: tTransaction,
  source: typeof knowledgeSource.$inferSelect,
  websiteId: string,
) {
  const shared = await tx
    .select({
      text: knowledgeSharedBlock.text,
      embedding: knowledgeSharedBlock.embedding,
      embeddingModel: knowledgeSharedBlock.embeddingModel,
    })
    .from(knowledgeSharedBlockSource)
    .innerJoin(
      knowledgeSharedBlock,
      eq(knowledgeSharedBlock.id, knowledgeSharedBlockSource.blockId),
    )
    .where(
      and(
        eq(knowledgeSharedBlockSource.sourceId, source.id),
        eq(knowledgeSharedBlock.websiteId, websiteId),
      ),
    )
    .orderBy(asc(knowledgeSharedBlock.id))
  if (shared.length) {
    const [last] = await tx
      .select({
        position: sql<number>`coalesce(max(${knowledgeChunk.position}), -1)::int`,
      })
      .from(knowledgeChunk)
      .where(eq(knowledgeChunk.sourceId, source.id))
    await tx.insert(knowledgeChunk).values(
      shared.map((block, index) => ({
        ...ownerOf(source),
        sourceId: source.id,
        kind: 'content' as const,
        position: last.position + index + 1,
        ...block,
      })),
    )
  }
  const text =
    [source.cleanedText, ...shared.map((block) => block.text)]
      .filter(Boolean)
      .join('\n') || null
  await tx
    .update(knowledgeSource)
    .set({
      parentId: null,
      ...(shared.length
        ? {
            cleanedText: text,
            cleanedCharCount: text?.length ?? 0,
            // The representation changed; force the next refresh to verify it.
            contentHash: null,
            etag: null,
            lastModifiedHeader: null,
            readHash: null,
          }
        : {}),
    })
    .where(eq(knowledgeSource.id, source.id))
}

export async function deleteKnowledgeSource(
  owner: iKnowledgeOwner,
  sourceId: string,
) {
  const objectKeys = await db.transaction(async (tx) => {
    await lockOwner(tx, owner)
    const [source] = await tx
      .select()
      .from(knowledgeSource)
      .where(
        and(eq(knowledgeSource.id, sourceId), ownedBy(knowledgeSource, owner)),
      )
      .for('update')
    if (!source) throw new ApiError(404, 'source_missing', 'Source not found')
    const children = await tx
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.parentId, sourceId))
      .for('update')
    // Deleting is never blocked by reading: the owner expects it to take effect
    // now. Jobs for what's being removed stop; ones for its parent website
    // carry on (its other pages are unaffected).
    await closeActiveRuns(
      tx,
      [sourceId, ...children.map((child) => child.id)],
      'Stopped: source deleted',
    )
    const [parent] = source.parentId
      ? await tx
          .select({ kind: knowledgeSource.kind })
          .from(knowledgeSource)
          .where(eq(knowledgeSource.id, source.parentId))
      : []
    if (parent?.kind === 'website' && source.kind === 'webPage') {
      // The next refresh would find this page again and add it back, so it
      // stays as an excluded marker with everything the bot learned removed.
      await tx
        .delete(knowledgeChunk)
        .where(eq(knowledgeChunk.sourceId, sourceId))
      await tx
        .delete(knowledgeSharedBlockSource)
        .where(eq(knowledgeSharedBlockSource.sourceId, sourceId))
      await tx
        .delete(knowledgeCorrection)
        .where(eq(knowledgeCorrection.sourceId, sourceId))
      await tx
        .update(knowledgeSource)
        .set({
          isIncluded: false,
          isPinned: false,
          cleanedText: null,
          cleanedCharCount: null,
          contentHash: null,
          pageProfile: null,
          pageActions: [],
          etag: null,
          lastModifiedHeader: null,
          readHash: null,
        })
        .where(eq(knowledgeSource.id, sourceId))
      await deleteOrphanSharedBlocks(tx, source.parentId!)
      return []
    }
    for (const child of children.filter((item) => item.isPinned))
      await preserveDetachedKnowledge(tx, child, sourceId)
    const removed = [source, ...children.filter((child) => !child.isPinned)]
    const keys = removed.flatMap((item) =>
      item.objectKey ? [item.objectKey] : [],
    )
    await recordStorageCleanup(tx, keys)
    const childIds = removed
      .filter((item) => item.id !== sourceId)
      .map((item) => item.id)
    if (childIds.length)
      await tx
        .delete(knowledgeSource)
        .where(inArray(knowledgeSource.id, childIds))
    await tx.delete(knowledgeSource).where(eq(knowledgeSource.id, sourceId))
    if (source.parentId) await deleteOrphanSharedBlocks(tx, source.parentId)
    return keys
  })
  // Storage availability cannot undo the committed deletion. The worker retries
  // this persisted intent after a failed delivery or process restart.
  await sweepStorageCleanup(objectKeys).catch(() => {
    console.error('Source storage cleanup deferred to worker')
  })
}

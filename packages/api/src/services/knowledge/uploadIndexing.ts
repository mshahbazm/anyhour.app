import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { knowledgeSource, indexRun } from '../../db/schema'
import { replaceContentChunks, writeProfileChunk } from './chunkPersistence'
import { extractPageBlocks } from './cleanup/extractBlocks'
import { createPageProfile } from './cleanup/pageProfile'
import { buildProfileChunk } from './profileChunk'
import { sourcePreparationUsage } from './preparationUsage'
import { sourceEmbeddingUsage } from './embeddingUsage'
import { chunkText } from './chunk'
import { runEmbeddingCheckpoint } from './embeddingCheckpoints'
import { embedTexts } from './embedding'
import { finishRunItem } from './runItems'
import { completeRunIfReady } from './runOrchestrator'
import { sourceHasNewerResult } from './sourceFreshness'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { env } from '../../env'
import { getR2Storage } from './r2Storage'
import {
  detectDocumentFormat,
  unreadableReason,
  DocumentUnreadableError,
  extractDocumentText,
} from './documents'
import { ownerOf } from './owner'

async function profileDocument(
  source: typeof knowledgeSource.$inferSelect,
  title: string,
  text: string,
) {
  const { blocks } = extractPageBlocks({
    markdown: text,
    title,
    url: `https://upload.local/${source.id}`,
  })
  const result = await createPageProfile(title, blocks)
  const record = await sourcePreparationUsage(ownerOf(source), source.id)
  await record('pageProfile', result)
  return result.profile
}

// First indexing of an upload reads the stored original; later runs reuse its text.
async function readUploadText(source: typeof knowledgeSource.$inferSelect) {
  if (!source.objectKey) throw new Error('Upload file is missing')
  const object = await getR2Storage().send(
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: source.objectKey }),
  )
  const bytes = await object.Body?.transformToByteArray()
  if (!bytes) throw new Error('Upload file is missing')
  const format = detectDocumentFormat({
    bytes,
    mimeType: source.mimeType,
    fileName: source.fileName,
  })
  if (!format)
    throw new DocumentUnreadableError(
      unreadableReason({
        bytes,
        mimeType: source.mimeType,
        fileName: source.fileName,
      }),
    )
  return extractDocumentText(bytes, format)
}

export async function indexUpload(
  runId: string,
  source: typeof knowledgeSource.$inferSelect,
  attemptCount: number,
) {
  const title = source.title ?? source.fileName ?? 'Source'
  const text = source.cleanedText ?? (await readUploadText(source))
  if (!text.trim()) throw new DocumentUnreadableError()
  const hash = createHash('sha256').update(text).digest('hex')
  const unchanged = hash === source.contentHash
  const chunks = unchanged ? [] : chunkText(text, title)
  // Documents get the same page profile as web pages, for navigation-style answers.
  const profile = unchanged ? null : await profileDocument(source, title, text)
  const profileText = unchanged ? null : buildProfileChunk(title, profile)
  let vectors: number[][] = []
  if (!unchanged) {
    const onUsage = await sourceEmbeddingUsage(ownerOf(source), source.id)
    vectors = (
      await embedTexts([...chunks, ...(profileText ? [profileText] : [])], {
        onUsage,
        checkpoint: runEmbeddingCheckpoint(runId, source.id, onUsage),
        signal: AbortSignal.timeout(8 * 60_000),
      })
    ).vectors
  }
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ startedAt: indexRun.startedAt, status: indexRun.status })
      .from(indexRun)
      .where(eq(indexRun.id, runId))
      .for('update')
    if (run?.status !== 'running') return
    const [current] = await tx
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, source.id))
      .for('update')
    if (!current) throw new Error('Upload source is missing')
    const superseded = sourceHasNewerResult(current, run.startedAt)
    // A matching hash from an earlier snapshot cannot justify skipping writes
    // or embeddings after the source changed. Retry with its current content.
    if (
      !superseded &&
      (current.contentHash !== source.contentHash ||
        current.cleanedText !== source.cleanedText ||
        current.title !== source.title ||
        current.fileName !== source.fileName)
    )
      throw new Error(
        'Upload changed during indexing; retry with its current content',
      )
    const outcome = unchanged || superseded ? 'unchanged' : 'indexed'
    if (
      !(await finishRunItem(tx, {
        runId,
        sourceId: source.id,
        outcome,
        expectedStatus: 'embedding',
        attemptCount,
      }))
    )
      return
    if (superseded) return
    if (!unchanged) {
      await replaceContentChunks(
        tx,
        ownerOf(source),
        source.id,
        chunks,
        vectors.slice(0, chunks.length),
      )
      await writeProfileChunk(
        tx,
        ownerOf(source),
        source.id,
        profileText,
        vectors[chunks.length],
      )
    }
    const now = new Date()
    await tx
      .update(knowledgeSource)
      .set({
        title,
        resultStartedAt: run.startedAt,
        ...(!unchanged
          ? {
              cleanedText: text,
              contentHash: hash,
              cleanedCharCount: text.length,
              pageProfile: profile,
              lastIndexedAt: now,
            }
          : {}),
        status: 'ready',
        lastAttemptStatus: outcome,
        lastError: null,
        lastCheckedAt: now,
      })
      .where(eq(knowledgeSource.id, source.id))
  })
  await completeRunIfReady(runId)
}

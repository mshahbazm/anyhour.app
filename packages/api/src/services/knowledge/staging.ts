import {
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { env } from '../../env'
import { z } from 'zod'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '../../db'
import { indexRun, indexRunItem } from '../../db/schema'
import { getR2Storage, deleteStoredObject } from './r2Storage'
import { recordStorageCleanup, sweepStorageCleanup } from './storageCleanup'
import type {
  iCleanupCheckpoint,
  iPageBlock,
  iPageProfile,
  iPreparationUsage,
  iSharedText,
} from './cleanup/types'

export interface iStagedPage {
  formatVersion?: string
  url: string
  title: string
  httpStatus?: 404 | 410
  html?: string
  markdown?: string
  preparedText?: string
  blocks?: iPageBlock[]
  retainedBlocks?: iPageBlock[]
  cleanup?: iCleanupCheckpoint
  shared?: iSharedText[]
  profile?: iPageProfile | null
  profileAttempted?: boolean
  pendingProfileUsage?: iPreparationUsage
  httpValidators?: { etag: string | null; lastModifiedHeader: string | null }
  /** fetchPage `readHash`: what the read served, before cleanup. */
  readHash?: string
}

export function pageStageKey(runId: string, sourceId: string) {
  return `index-runs/${runId}/pages/${sourceId}.json`
}

export function pageAttemptStageKey(
  runId: string,
  sourceId: string,
  stage: 'prepare' | 'group',
  attempt: number,
) {
  return `index-runs/${runId}/pages/${sourceId}/${stage}-${attempt}.json`
}

// Attempt keys are never reused. Retire replaced keys durably; if a process
// stops before registering this cleanup, the prefix sweep finds the object.
export async function retireUnreferencedStage(key: string) {
  const retired = await db.transaction(async (tx) => {
    // Lock runs before their items, matching ingestion's completion lock order.
    // A terminal whole run can leave a prepared/queued item behind; such a
    // reference no longer protects temporary evidence from collection.
    const runs = await tx
      .select({ status: indexRun.status })
      .from(indexRun)
      .where(
        inArray(
          indexRun.id,
          tx
            .select({ runId: indexRunItem.runId })
            .from(indexRunItem)
            .where(eq(indexRunItem.stagedContentKey, key)),
        ),
      )
      .for('update')
    if (runs.some((run) => ['queued', 'running'].includes(run.status)))
      return false
    await recordStorageCleanup(tx, [key])
    // Persist the deletion intent in the same transaction before dropping the
    // terminal reference. A failed DELETE remains recoverable from the outbox.
    await tx
      .update(indexRunItem)
      .set({ stagedContentKey: null })
      .where(eq(indexRunItem.stagedContentKey, key))
    return true
  })
  if (!retired) return
  await sweepStorageCleanup([key])
}

export async function writeStagedPage(key: string, page: iStagedPage) {
  await getR2Storage().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: JSON.stringify(page),
      ContentType: 'application/json',
    }),
  )
}

// Preserve the last successful checkpoint while its isolated successor is
// written. Only a first checkpoint with no predecessor registers before PUT.
export async function publishStagedPage(input: {
  runId: string
  sourceId: string
  attemptCount: number
  status: 'preparing' | 'prepared'
  previousKey: string | null
  key: string
  page: iStagedPage
  groupingLease?: Date
}) {
  const owned = and(
    eq(indexRunItem.runId, input.runId),
    eq(indexRunItem.sourceId, input.sourceId),
    eq(indexRunItem.attemptCount, input.attemptCount),
    eq(indexRunItem.status, input.status),
  )
  const publish = (afterWrite: boolean) =>
    db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(indexRun)
        .where(eq(indexRun.id, input.runId))
        .for('update')
      if (
        run?.status !== 'running' ||
        (input.groupingLease &&
          run.cleanupLeaseUntil?.getTime() !== input.groupingLease.getTime())
      )
        return false
      const [item] = await tx
        .select({ key: indexRunItem.stagedContentKey })
        .from(indexRunItem)
        .where(owned)
        .for('update')
      if (!item || (item.key !== input.previousKey && item.key !== input.key))
        return false
      if (afterWrite || item.key === null)
        await tx
          .update(indexRunItem)
          .set({ stagedContentKey: input.key })
          .where(owned)
      return true
    })
  if (!(await publish(false))) return false
  await writeStagedPage(input.key, input.page)
  if (!(await publish(true))) return false
  if (input.previousKey && input.previousKey !== input.key)
    await retireUnreferencedStage(input.previousKey)
  return true
}

export class InvalidStagedPageError extends Error {}

const stagedBlockSchema = z.object({
  id: z.string(),
  text: z.string(),
  heading: z.string(),
  region: z.enum(['main', 'header', 'footer', 'navigation', 'sidebar']),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  inlineParts: z
    .array(z.object({ text: z.string(), url: z.string().optional() }))
    .optional(),
})
const stagedPageSchema = z.object({
  url: z.string(),
  title: z.string(),
  formatVersion: z.string().optional(),
  html: z.string().optional(),
  markdown: z.string().optional(),
  preparedText: z.string().optional(),
  blocks: z.array(stagedBlockSchema).optional(),
  retainedBlocks: z.array(stagedBlockSchema).optional(),
  shared: z.array(z.object({ key: z.string(), text: z.string() })).optional(),
})

export async function readStagedPage(key: string): Promise<iStagedPage> {
  const response = await getR2Storage().send(
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
  )
  const body = await response.Body?.transformToString()
  if (!body) throw new InvalidStagedPageError('Staged page is empty')
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new InvalidStagedPageError('Staged page contains invalid JSON')
  }
  if (!stagedPageSchema.safeParse(value).success)
    throw new InvalidStagedPageError('Staged page is invalid')
  return value as iStagedPage
}

export async function readStagedPageIfPresent(key: string) {
  try {
    return await readStagedPage(key)
  } catch (error) {
    if (error instanceof InvalidStagedPageError) return null
    // A registered key may precede its first successful PUT. Only absence is
    // recoverable by refetching; permission/network/invalid-data errors retry.
    if (
      error &&
      typeof error === 'object' &&
      (('name' in error &&
        ['NoSuchKey', 'NotFound'].includes(String(error.name))) ||
        ('$metadata' in error &&
          (error.$metadata as { httpStatusCode?: number })?.httpStatusCode ===
            404))
    )
      return null
    throw error
  }
}

export async function cleanupPageStage(
  runId: string,
  sourceId: string,
  key: string,
) {
  try {
    await deleteStoredObject(key)
    await db
      .update(indexRunItem)
      .set({ stagedContentKey: null })
      .where(
        and(
          eq(indexRunItem.runId, runId),
          eq(indexRunItem.sourceId, sourceId),
          eq(indexRunItem.stagedContentKey, key),
          inArray(indexRunItem.status, ['indexed', 'unchanged', 'failed']),
        ),
      )
  } catch {
    /* Keep the durable key for the terminal-stage sweeper. */
  }
}
// Continue bounded scans fairly across invocations, instead of repeatedly
// inspecting the first 10,000 keys. A restart can safely restart the scan.
let stageSweepCursor: string | undefined

export async function sweepStagedPages() {
  const terminal = await db
    .select()
    .from(indexRunItem)
    .where(
      and(
        inArray(indexRunItem.status, ['indexed', 'unchanged', 'failed']),
        isNotNull(indexRunItem.stagedContentKey),
      ),
    )
    .limit(1000)
  for (const item of terminal)
    await cleanupPageStage(item.runId, item.sourceId, item.stagedContentKey!)
  if (!env.R2_ENDPOINT || !env.R2_BUCKET) return
  for (let page = 0; page < 10; page++) {
    const objects = await getR2Storage().send(
      new ListObjectsV2Command({
        Bucket: env.R2_BUCKET,
        Prefix: 'index-runs/',
        ContinuationToken: stageSweepCursor,
        MaxKeys: 1000,
      }),
    )
    for (const object of objects.Contents ?? []) {
      if (
        !object.Key ||
        !object.LastModified ||
        object.LastModified.getTime() > Date.now() - 24 * 60 * 60_000
      )
        continue
      const runId = object.Key.split('/')[1]
      const [run] = await db
        .select({ status: indexRun.status })
        .from(indexRun)
        .where(eq(indexRun.id, runId))
        .limit(1)
      if (!run || ['completed', 'failed'].includes(run.status))
        await retireUnreferencedStage(object.Key)
      else if (/\/pages\/[^/]+\/(?:prepare|group)-\d+\.json$/u.test(object.Key))
        // Older than one day is well beyond preparation/embedding leases and
        // provider timeouts. Never collect the currently referenced checkpoint.
        await retireUnreferencedStage(object.Key)
    }
    stageSweepCursor = objects.NextContinuationToken
    if (!stageSweepCursor) break
  }
}

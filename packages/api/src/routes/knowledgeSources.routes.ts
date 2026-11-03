import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { db } from '../db'
import { indexRun, knowledgeSource } from '../db/schema'
import {
  createKnowledgeNoteSchema,
  createSourceSchema,
  resolveCorrectionSchema,
  updateKnowledgeNoteSchema,
  updateSourceSchema,
} from '../schemas/assistant.schema'
import { draftTextSchema } from '../schemas/draft.schema'
import { requirePermission } from '../services/auth/authorize'
import { ApiError } from '../services/http/apiError'
import { validateJson } from '../services/http/validateJson'
import {
  openDecisions,
  recordCorrections,
  resolveCorrection,
} from '../services/knowledge/corrections/corrections'
import { sourceCatalogue } from '../services/knowledge/catalogue'
import { createNote, listNotes, updateNote } from '../services/knowledge/notes'
import { draftNoteFromText } from '../services/knowledge/noteDrafts'
import {
  clearNoteOffer,
  requireTeachingReply,
} from '../services/support/noteOffer'
import {
  businessOwner,
  knowledgeChanged,
  ownedBy,
} from '../services/knowledge/owner'
import type { iKnowledgeOwner } from '../services/knowledge/owner'
import { queueRun } from '../services/knowledge/runRequests'
import { readSourceSharedText } from '../services/knowledge/sharedContent'
import {
  answerableKinds,
  searchableSource,
} from '../services/knowledge/sourceEligibility'
import {
  createKnowledgeSource,
  createUploadSource,
  deleteKnowledgeSource,
  updateKnowledgeSource,
} from '../services/knowledge/sourceOperations'
import { workerAlive } from '../services/queue/workerHealth'
import { getBusinessProfile } from '../services/workspace/businessProfile'

// Websites, pages, files and notes: Your business, the one layer of
// knowledge, under /business (docs/focusedProduct.md, "One AI per business").
export const knowledgeSourceRoutes = new Hono()

const prefix = '/:organizationId/business'

async function resolve(c: Context, action: 'read' | 'update') {
  const organizationId = c.req.param('organizationId')!
  await requirePermission(
    c.req.raw.headers,
    organizationId,
    'assistant',
    action,
  )
  return businessOwner(organizationId)
}

const sameTitle = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

function sourceArchiveNotice(
  source: Pick<
    typeof knowledgeSource.$inferSelect,
    'archivedAt' | 'deleteAfter' | 'contentDeletedAt'
  >,
) {
  if (!source.archivedAt) return null
  if (source.contentDeletedAt)
    return 'This page remained unavailable. Its saved content has been deleted; its URL is retained for history and future discovery.'
  return `This page returned 404 or 410 and has been archived from chat knowledge. Its saved content will be deleted after ${source.deleteAfter?.toISOString()} only if a new check confirms it is still missing.`
}

async function readableSource(reader: iKnowledgeOwner, sourceId: string) {
  const [source] = await db
    .select()
    .from(knowledgeSource)
    .where(
      and(eq(knowledgeSource.id, sourceId), ownedBy(knowledgeSource, reader)),
    )
    .limit(1)
  if (!source) throw new ApiError(404, 'source_missing', 'Source not found')
  return source
}

// Whether the reader has something to answer from, and whether reading is
// under way, for the pages and the chat preview.
export async function readingStatus(reader: iKnowledgeOwner) {
  const [source] = await db
    .select({ id: knowledgeSource.id })
    .from(knowledgeSource)
    .where(
      and(
        ownedBy(knowledgeSource, reader),
        searchableSource(),
        inArray(knowledgeSource.kind, [...answerableKinds]),
      ),
    )
    .limit(1)
  const runs = await db
    .select({
      id: indexRun.id,
      status: indexRun.status,
      phase: indexRun.phase,
      discoveredCount: indexRun.discoveredCount,
      indexedCount: indexRun.indexedCount,
      failedCount: indexRun.failedCount,
      errorSummary: indexRun.errorSummary,
    })
    .from(indexRun)
    .where(ownedBy(indexRun, reader))
    .orderBy(desc(indexRun.startedAt))
    .limit(20)
  const [active] = await db
    .select({ id: indexRun.id })
    .from(indexRun)
    .where(
      and(
        ownedBy(indexRun, reader),
        inArray(indexRun.status, ['queued', 'running']),
      ),
    )
    .limit(1)
  return {
    ready: Boolean(source),
    indexing: Boolean(active),
    // Work is waiting but the background worker isn't running to do it.
    paused: Boolean(active) && !(await workerAlive()),
    runs,
  }
}

// Your business at a glance: what the business is about and its website.
knowledgeSourceRoutes.get(prefix, async (c) => {
  const owner = await resolve(c, 'read')
  return c.json(await getBusinessProfile(owner.organizationId))
})

knowledgeSourceRoutes.get(`${prefix}/sources`, async (c) => {
  const owner = await resolve(c, 'read')
  const limit = Number(c.req.query('limit') ?? '100')
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new ApiError(422, 'invalid_limit', 'Limit must be between 1 and 200')
  const cursor = c.req.query('cursor')
  const [cursorSource] = cursor
    ? await db
        .select({ id: knowledgeSource.id })
        .from(knowledgeSource)
        .where(
          and(ownedBy(knowledgeSource, owner), eq(knowledgeSource.id, cursor)),
        )
        .limit(1)
    : []
  if (cursor && !cursorSource)
    throw new ApiError(422, 'invalid_cursor', 'Source cursor is invalid')
  const rows = await db
    .select({
      id: knowledgeSource.id,
      organizationId: knowledgeSource.organizationId,
      parentId: knowledgeSource.parentId,
      kind: knowledgeSource.kind,
      inputUrl: knowledgeSource.inputUrl,
      canonicalUrl: knowledgeSource.canonicalUrl,
      fileName: knowledgeSource.fileName,
      mimeType: knowledgeSource.mimeType,
      fileSize: knowledgeSource.fileSize,
      title: knowledgeSource.title,
      includePaths: knowledgeSource.includePaths,
      excludePaths: knowledgeSource.excludePaths,
      isPinned: knowledgeSource.isPinned,
      isIncluded: knowledgeSource.isIncluded,
      discoveredVia: knowledgeSource.discoveredVia,
      depth: knowledgeSource.depth,
      contentHash: knowledgeSource.contentHash,
      cleanedCharCount: knowledgeSource.cleanedCharCount,
      status: knowledgeSource.status,
      lastAttemptStatus: knowledgeSource.lastAttemptStatus,
      etag: knowledgeSource.etag,
      lastModifiedHeader: knowledgeSource.lastModifiedHeader,
      lastSeenAt: knowledgeSource.lastSeenAt,
      lastCheckedAt: knowledgeSource.lastCheckedAt,
      lastIndexedAt: knowledgeSource.lastIndexedAt,
      lastError: knowledgeSource.lastError,
      archivedAt: knowledgeSource.archivedAt,
      deleteAfter: knowledgeSource.deleteAfter,
      nextArchiveCheckAt: knowledgeSource.nextArchiveCheckAt,
      contentDeletedAt: knowledgeSource.contentDeletedAt,
      createdAt: knowledgeSource.createdAt,
      updatedAt: knowledgeSource.updatedAt,
    })
    .from(knowledgeSource)
    .where(
      and(
        ownedBy(knowledgeSource, owner),
        cursorSource
          ? sql`(${knowledgeSource.createdAt}, ${knowledgeSource.id}) < (
              select cursor_source.created_at, cursor_source.id
              from knowledge_source cursor_source
              where cursor_source.id = ${cursor}
            )`
          : undefined,
      ),
    )
    .orderBy(desc(knowledgeSource.createdAt), desc(knowledgeSource.id))
    .limit(limit + 1)
  if (rows.length > limit) {
    c.header('X-Next-Cursor', rows[limit - 1].id)
    c.header('Access-Control-Expose-Headers', 'X-Next-Cursor')
  }
  return c.json(
    rows.slice(0, limit).map((source) => ({
      ...source,
      archiveNotice: sourceArchiveNotice(source),
    })),
  )
})

knowledgeSourceRoutes.get(`${prefix}/sources/:sourceId`, async (c) => {
  const reader = await resolve(c, 'read')
  const source = await readableSource(reader, c.req.param('sourceId'))
  const shared = await readSourceSharedText(source.id)
  return c.json({
    ...source,
    archiveNotice: sourceArchiveNotice(source),
    cleanedText:
      [source.cleanedText, ...shared.map((block) => block.text)]
        .filter(Boolean)
        .join('\n') || null,
  })
})

knowledgeSourceRoutes.post(
  `${prefix}/sources`,
  validateJson(createSourceSchema),
  async (c) => {
    const owner = await resolve(c, 'update')
    return c.json(await createKnowledgeSource(owner, c.req.valid('json')), 201)
  },
)

knowledgeSourceRoutes.post(
  `${prefix}/uploads`,
  bodyLimit({
    maxSize: 11 * 1024 * 1024,
    onError: (c) =>
      c.json(
        {
          error: {
            code: 'file_too_large',
            message: 'Maximum file size is 10 MB',
          },
        },
        413,
      ),
  }),
  async (c) => {
    const owner = await resolve(c, 'update')
    const body = await c.req.parseBody()
    const file = body.file
    if (!(file instanceof File))
      throw new ApiError(422, 'file_required', 'Upload a file')
    return c.json(await createUploadSource(owner, file), 201)
  },
)

knowledgeSourceRoutes.patch(
  `${prefix}/sources/:sourceId`,
  validateJson(updateSourceSchema),
  async (c) => {
    const reader = await resolve(c, 'update')
    const source = await readableSource(reader, c.req.param('sourceId'))
    const updated = await updateKnowledgeSource(
      reader,
      source.id,
      c.req.valid('json'),
    )
    await knowledgeChanged(reader)
    return c.json(updated)
  },
)

knowledgeSourceRoutes.delete(`${prefix}/sources/:sourceId`, async (c) => {
  const reader = await resolve(c, 'update')
  const source = await readableSource(reader, c.req.param('sourceId'))
  await deleteKnowledgeSource(reader, source.id)
  await knowledgeChanged(reader)
  return c.body(null, 204)
})

knowledgeSourceRoutes.get(`${prefix}/runs`, async (c) => {
  const reader = await resolve(c, 'read')
  return c.json(
    await db
      .select()
      .from(indexRun)
      .where(ownedBy(indexRun, reader))
      .orderBy(desc(indexRun.startedAt))
      .limit(100),
  )
})

knowledgeSourceRoutes.post(`${prefix}/sources/:sourceId/runs`, async (c) => {
  const reader = await resolve(c, 'update')
  const source = await readableSource(reader, c.req.param('sourceId'))
  return c.json(await queueRun(reader, source.id, 'manual'), 202)
})

// A short list of what the AI learns from.
knowledgeSourceRoutes.get(`${prefix}/catalogue`, async (c) =>
  c.json(await sourceCatalogue(await resolve(c, 'read'), 200)),
)

knowledgeSourceRoutes.get(`${prefix}/status`, async (c) =>
  c.json(await readingStatus(await resolve(c, 'read'))),
)

// Facts told in chat.
knowledgeSourceRoutes.get(`${prefix}/notes`, async (c) => {
  const reader = await resolve(c, 'read')
  const notes = await listNotes(reader)
  return c.json(
    notes.map((note) => ({
      id: note.id,
      title: note.title,
      text: note.text,
      status: note.status,
      updatedAt: note.updatedAt,
      overrides: note.overrides,
    })),
  )
})

knowledgeSourceRoutes.post(
  `${prefix}/notes`,
  validateJson(createKnowledgeNoteSchema),
  async (c) => {
    const reader = await resolve(c, 'update')
    const { title, text, overrides, fromMessageId } = c.req.valid('json')
    const existing = (await listNotes(reader)).find((note) =>
      sameTitle(note.title, title),
    )
    if (existing)
      throw new ApiError(
        409,
        'note_exists',
        `A note called ${JSON.stringify(existing.title)} already exists (id ${existing.id}). Update it instead of adding another.`,
      )
    if (fromMessageId)
      await requireTeachingReply(reader.organizationId, fromMessageId)
    const id = await createNote(
      reader,
      title,
      text,
      fromMessageId ? 'reply' : 'note',
    )
    await recordCorrections(reader, id, overrides ?? [])
    if (fromMessageId)
      await clearNoteOffer(reader.organizationId, fromMessageId)
    return c.json({ id, title, text }, 201)
  },
)

// What the owner tells the AI on Your business, drafted as one note for the
// normal save (after the website check); saves nothing.
knowledgeSourceRoutes.post(
  `${prefix}/notes/drafts`,
  validateJson(draftTextSchema),
  async (c) => {
    const reader = await resolve(c, 'update')
    return c.json(await draftNoteFromText(reader, c.req.valid('json').text))
  },
)

// Edits a note in place.
knowledgeSourceRoutes.put(
  `${prefix}/notes/:noteId`,
  validateJson(updateKnowledgeNoteSchema),
  async (c) => {
    const reader = await resolve(c, 'update')
    const noteId = c.req.param('noteId')
    const { title, text, overrides } = c.req.valid('json')
    const notes = await listNotes(reader)
    const note = notes.find((item) => item.id === noteId)
    if (!note) throw new ApiError(404, 'note_missing', 'Note not found')
    const clash = notes.find(
      (item) => item.id !== noteId && sameTitle(item.title, title),
    )
    if (clash)
      throw new ApiError(
        409,
        'note_exists',
        `Another note is already called ${JSON.stringify(clash.title)} (id ${clash.id}).`,
      )
    await updateNote(reader, noteId, title, text)
    await recordCorrections(reader, noteId, overrides ?? [])
    return c.json({ id: noteId, title, text })
  },
)

knowledgeSourceRoutes.delete(`${prefix}/notes/:noteId`, async (c) => {
  const reader = await resolve(c, 'update')
  const note = (await listNotes(reader)).find(
    (item) => item.id === c.req.param('noteId'),
  )
  if (!note) throw new ApiError(404, 'note_missing', 'Note not found')
  await deleteKnowledgeSource(reader, note.id)
  await knowledgeChanged(reader)
  return c.body(null, 204)
})

// Website changes that now disagree with what the owner said.
knowledgeSourceRoutes.get(`${prefix}/decisions`, async (c) =>
  c.json(await openDecisions(await resolve(c, 'read'))),
)

knowledgeSourceRoutes.patch(
  `${prefix}/decisions/:correctionId`,
  validateJson(resolveCorrectionSchema),
  async (c) => {
    const reader = await resolve(c, 'update')
    const { decision } = c.req.valid('json')
    return c.json(
      await resolveCorrection({
        ...reader,
        correctionId: c.req.param('correctionId'),
        decision,
      }),
    )
  },
)

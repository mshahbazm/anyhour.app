import { createHash } from 'node:crypto'
import { aliasedTable, and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { knowledgeCorrection, knowledgeSource } from '../../db/schema'
import { ApiError } from '../http/apiError'
import { chunkText } from './chunk'
import { replaceContentChunks } from './chunkPersistence'
import { embedTexts } from './embedding'
import { embeddingUsageRecorder } from './embeddingUsage'
import { sourceUsageContext } from './sourceUsageContext'
import { pageName } from './corrections/pageName'
import { knowledgeChanged, ownedBy, ownerOf } from './owner'
import type { iKnowledgeOwner } from './owner'

// Facts the owner types in chat become notes: their own kind of knowledge
// source, stored as Markdown text. One note per topic: a fact that changes is
// edited in place, never repeated.
const noteMarkdown = (title: string, text: string) => `# ${title}\n\n${text}\n`

function noteBody(markdown: string | null, title: string) {
  const heading = `# ${title}\n\n`
  const text = markdown ?? ''
  return (text.startsWith(heading) ? text.slice(heading.length) : text).trim()
}

/** The workspace's notes. */
export async function listNotes(reader: iKnowledgeOwner) {
  const rows = await db
    .select({
      id: knowledgeSource.id,
      title: knowledgeSource.title,
      text: knowledgeSource.cleanedText,
      status: knowledgeSource.status,
      updatedAt: knowledgeSource.updatedAt,
    })
    .from(knowledgeSource)
    .where(
      and(ownedBy(knowledgeSource, reader), eq(knowledgeSource.kind, 'note')),
    )
    .orderBy(asc(knowledgeSource.createdAt))
  // Pages each note knowingly differs from, so the owner sees it in the list.
  const page = aliasedTable(knowledgeSource, 'page')
  const overrides = rows.length
    ? await db
        .select({
          noteId: knowledgeCorrection.noteId,
          sourceId: knowledgeCorrection.sourceId,
          page: page.title,
        })
        .from(knowledgeCorrection)
        .innerJoin(page, eq(page.id, knowledgeCorrection.sourceId))
        .where(
          and(
            ownedBy(knowledgeCorrection, reader),
            inArray(knowledgeCorrection.status, ['active', 'needsReview']),
          ),
        )
    : []
  return rows.map((row) => {
    const title = row.title ?? 'Note'
    return {
      id: row.id,
      title,
      text: noteBody(row.text, title),
      status: row.status,
      updatedAt: row.updatedAt,
      overrides: overrides
        .filter((item) => item.noteId === row.id)
        .map((item) => ({
          sourceId: item.sourceId,
          page: pageName(item.page) ?? 'A page',
        })),
    }
  })
}

// A note is a few owner-typed sentences, embedded inside the request and
// written together with its chunks: it is either saved and searchable at
// once, or not saved at all and the owner hears it failed.
async function writeNote(
  owner: iKnowledgeOwner,
  noteId: string | null,
  title: string,
  text: string,
  discoveredVia: 'note' | 'reply' = 'note',
) {
  const markdown = noteMarkdown(title, text)
  const chunks = chunkText(markdown, title)
  const { vectors } = await embedTexts(chunks, {
    onUsage: embeddingUsageRecorder(sourceUsageContext(owner, noteId ?? '')),
    signal: AbortSignal.timeout(30_000),
  })
  const now = new Date()
  const learned = {
    title,
    cleanedText: markdown,
    contentHash: createHash('sha256').update(markdown).digest('hex'),
    cleanedCharCount: markdown.length,
    status: 'ready' as const,
    lastIndexedAt: now,
    lastCheckedAt: now,
    resultStartedAt: now,
    updatedAt: now,
  }
  const id = await db.transaction(async (tx) => {
    const [row] = noteId
      ? await tx
          .update(knowledgeSource)
          .set(learned)
          .where(
            and(
              eq(knowledgeSource.id, noteId),
              ownedBy(knowledgeSource, owner),
              eq(knowledgeSource.kind, 'note'),
            ),
          )
          .returning({ id: knowledgeSource.id })
      : await tx
          .insert(knowledgeSource)
          .values({
            ...ownerOf(owner),
            kind: 'note',
            discoveredVia,
            ...learned,
          })
          .returning({ id: knowledgeSource.id })
    if (!row) throw new ApiError(404, 'note_missing', 'Note not found')
    await replaceContentChunks(tx, owner, row.id, chunks, vectors)
    return row.id
  })
  await knowledgeChanged(owner)
  return id
}

/** Saves a new note to Your business; `reply` when learned from a person's answer to a customer. */
export function createNote(
  owner: iKnowledgeOwner,
  title: string,
  text: string,
  discoveredVia: 'note' | 'reply' = 'note',
) {
  return writeNote(owner, null, title, text, discoveredVia)
}

/** Edits a note in place. */
export async function updateNote(
  reader: iKnowledgeOwner,
  noteId: string,
  title: string,
  text: string,
) {
  const note = (await listNotes(reader)).find((item) => item.id === noteId)
  if (!note) throw new ApiError(404, 'note_missing', 'Note not found')
  await writeNote(reader, note.id, title, text)
}

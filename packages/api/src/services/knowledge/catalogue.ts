import { and, asc, count, eq, isNull, max, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import { knowledgeSource } from '../../db/schema'
import { ownedBy } from './owner'
import type { iKnowledgeOwner } from './owner'

// What the AI learns from (Your business), short enough for a prompt: one
// line per website, page or file (never one per page of a site).
export const catalogueLimit = 25

export interface iCatalogueSource {
  id: string
  kind: (typeof knowledgeSource.$inferSelect)['kind']
  name: string
  url: string | null
  /** Pages learned, for a website. */
  pages: number | null
  status: (typeof knowledgeSource.$inferSelect)['status']
  isIncluded: boolean
  lastReadAt: Date | null
}

export interface iSourceCatalogue {
  sources: iCatalogueSource[]
  /** Websites, pages and files beyond the limit. */
  more: number
  notes: { count: number; lastAt: Date | null }
}

function host(url: string | null) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : null
  } catch {
    return null
  }
}

export async function sourceCatalogue(
  reader: iKnowledgeOwner,
  limit = catalogueLimit,
): Promise<iSourceCatalogue> {
  const child = sql.raw('child')
  const roots = and(
    ownedBy(knowledgeSource, reader),
    isNull(knowledgeSource.parentId),
    ne(knowledgeSource.kind, 'note'),
  )
  const rows = await db
    .select({
      id: knowledgeSource.id,
      kind: knowledgeSource.kind,
      title: knowledgeSource.title,
      fileName: knowledgeSource.fileName,
      inputUrl: knowledgeSource.inputUrl,
      canonicalUrl: knowledgeSource.canonicalUrl,
      status: knowledgeSource.status,
      isIncluded: knowledgeSource.isIncluded,
      lastIndexedAt: knowledgeSource.lastIndexedAt,
      pages: sql<number>`(select count(*) from ${knowledgeSource} ${child} where ${child}.parent_id = ${knowledgeSource.id} and ${child}.status = 'ready' and ${child}.is_included and ${child}.archived_at is null)::int`,
      pagesReadAt: sql<
        string | null
      >`(select max(${child}.last_indexed_at) from ${knowledgeSource} ${child} where ${child}.parent_id = ${knowledgeSource.id})`,
    })
    .from(knowledgeSource)
    .where(roots)
    .orderBy(asc(knowledgeSource.createdAt))
    .limit(limit)
  const [total] = await db
    .select({ value: count() })
    .from(knowledgeSource)
    .where(roots)
  const [notes] = await db
    .select({
      count: count(),
      lastAt: max(knowledgeSource.updatedAt),
    })
    .from(knowledgeSource)
    .where(
      and(ownedBy(knowledgeSource, reader), eq(knowledgeSource.kind, 'note')),
    )
  return {
    sources: rows.map((row) => {
      const url = row.canonicalUrl ?? row.inputUrl
      const read = [
        row.lastIndexedAt,
        row.pagesReadAt && new Date(row.pagesReadAt),
      ]
        .filter((value): value is Date => Boolean(value))
        .sort((a, b) => b.getTime() - a.getTime())[0]
      return {
        id: row.id,
        kind: row.kind,
        name:
          row.kind === 'website'
            ? (host(url) ?? row.title ?? 'Website')
            : (row.title ?? row.fileName ?? host(url) ?? 'Untitled'),
        url: row.kind === 'upload' ? null : url,
        pages: row.kind === 'website' ? row.pages : null,
        status: row.status,
        isIncluded: row.isIncluded,
        lastReadAt: read ?? null,
      }
    }),
    more: Math.max(0, (total?.value ?? 0) - rows.length),
    notes: { count: notes?.count ?? 0, lastAt: notes?.lastAt ?? null },
  }
}

const day = (value: Date | null) =>
  value ? value.toISOString().slice(0, 10) : 'not yet'

const kindWords: Record<string, string> = {
  website: 'Website',
  webPage: 'Page',
  publicDocument: 'Document link',
  upload: 'File',
  youtubeVideo: 'Video',
  youtubePlaylist: 'Playlist',
  youtubeChannel: 'Channel',
}

// For the owner's chat: names, kinds, pages and when each was last read.
// Names come from websites and files, so they're quoted as data.
export function ownerCatalogueLines(catalogue: iSourceCatalogue) {
  const lines = catalogue.sources.map((source) => {
    const parts = [
      `${kindWords[source.kind] ?? 'Source'} ${JSON.stringify(source.name.slice(0, 120))}`,
      source.pages !== null ? `${source.pages} pages` : null,
      `last read ${day(source.lastReadAt)}`,
      source.isIncluded ? null : 'switched off',
      source.status === 'failed' || source.status === 'unsupported'
        ? "couldn't be read"
        : null,
    ]
    return `- ${parts.filter(Boolean).join(', ')}`
  })
  if (catalogue.more)
    lines.push(`- …and ${catalogue.more} more (my_sources lists them all)`)
  const { count: notes } = catalogue.notes
  if (notes)
    lines.push(
      `- ${notes} ${notes === 1 ? 'note' : 'notes'} the owner told me in chat`,
    )
  return lines
}

// For visitors: website pages are public, so their address and title may be
// named. Files are only ever "a document from the business": their names are
// the owner's and may not be meant for visitors.
export function visitorCatalogueLines(catalogue: iSourceCatalogue) {
  let files = 0
  const lines: string[] = []
  for (const source of catalogue.sources) {
    if (!source.isIncluded || source.status !== 'ready') continue
    if (source.kind === 'upload' || !source.url) {
      files += 1
      continue
    }
    const name = JSON.stringify(source.name.slice(0, 120))
    lines.push(
      source.kind === 'website'
        ? `- The website ${name}${source.pages ? ` (${source.pages} pages)` : ''}`
        : `- ${kindWords[source.kind] ?? 'Page'} ${name}: ${source.url}`,
    )
  }
  if (files)
    lines.push(
      files === 1
        ? '- A document from the business'
        : `- ${files} documents from the business`,
    )
  if (catalogue.notes.count) lines.push('- Facts the business told me directly')
  if (catalogue.more) lines.push(`- …and ${catalogue.more} more sources`)
  return lines
}

// Visitor chats ask on every message; what the AI learns from changes
// rarely, so each workspace's catalogue is kept for a minute.
const cached = new Map<string, { at: number; value: iSourceCatalogue }>()
const cacheMs = 60_000

export async function cachedSourceCatalogue(reader: iKnowledgeOwner) {
  const key = reader.organizationId
  const hit = cached.get(key)
  if (hit && Date.now() - hit.at < cacheMs) return hit.value
  const value = await sourceCatalogue(reader)
  if (cached.size > 1000) cached.clear()
  cached.set(key, { at: Date.now(), value })
  return value
}

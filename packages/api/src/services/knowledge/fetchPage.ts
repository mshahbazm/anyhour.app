import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { indexRun, type knowledgeSource } from '../../db/schema'
import { extractPageBlocks } from './cleanup/extractBlocks'
import {
  isCurrentContentHash,
  knowledgeFormatVersion,
} from './cleanup/formatBlocks'
import { PageUnavailableError } from './pageFailure'
import type { iStagedPage } from './staging'
import {
  detectDocumentFormat,
  documentFormats,
  DocumentUnreadableError,
  extractDocumentText,
  unreadableReason,
} from './documents'
import { inspectHtml } from './web'
import { assertPageScope } from './pageScope'
import { sourceScope } from './sourceScope'
import { ownerOf } from './owner'
import { sourceUsageContext } from './sourceUsageContext'
import {
  pageBytes,
  pageHtml,
  PageNotFoundError,
  readPage,
  type iReadPage,
} from '../pageReading/read'

// Files read as documents from the start: their bytes, not a page.
const fileExtensions = new Set<string>([
  ...documentFormats.pdf.extensions,
  ...documentFormats.docx.extensions,
])
const isFileUrl = (url: string) =>
  fileExtensions.has(
    new URL(url).pathname.split('.').pop()?.toLowerCase() ?? '',
  )

/**
 * What a read served, before cleanup: the page's blocks (text, links and
 * where they sit), so scripts, nonces and markup changes don't count. The
 * same hash as the last read means the page is unchanged.
 */
export function readHash(
  page: Pick<iStagedPage, 'url' | 'title' | 'html' | 'markdown'>,
) {
  const { title, blocks } = extractPageBlocks(page)
  return `${knowledgeFormatVersion}:${createHash('sha256')
    .update(JSON.stringify([title, blocks]))
    .digest('hex')}`
}

// Read a page through the page reader (pageReading/). A page whose content
// hashes the same as its last read is "unchanged", unless forced or its
// stored result can't stand as it is.
export async function fetchPage(
  source: typeof knowledgeSource.$inferSelect,
  { force = false, runId }: { force?: boolean; runId?: string } = {},
): Promise<{ page: iStagedPage; unchanged: boolean }> {
  const url = source.canonicalUrl ?? source.inputUrl
  if (!url) throw new Error('Page URL is missing')
  const scope = await sourceScope(source)
  assertPageScope(scope, url)
  const known =
    !force &&
    isCurrentContentHash(source.contentHash) &&
    !source.archivedAt &&
    source.pageProfile
  const [run] = runId
    ? await db
        .select({ startedAt: indexRun.startedAt })
        .from(indexRun)
        .where(eq(indexRun.id, runId))
    : []
  let read: iReadPage
  try {
    read = await readPage(url, {
      kind: isFileUrl(url) ? 'document' : 'page',
      usage: sourceUsageContext(ownerOf(source), source.id),
      ...(run?.startedAt
        ? {
            websiteRead: {
              websiteId: source.parentId ?? source.id,
              startedAt: run.startedAt,
            },
          }
        : {}),
    })
  } catch (error) {
    if (error instanceof PageNotFoundError)
      throw new PageUnavailableError(error.status)
    throw error
  }
  assertPageScope(scope, read.url)
  const httpValidators = read.validators
  const page = await stagedPage(source, read)
  const hash = readHash(page)
  return {
    page: { ...page, httpValidators, readHash: hash },
    unchanged: Boolean(known) && hash === source.readHash,
  }
}

async function stagedPage(
  source: typeof knowledgeSource.$inferSelect,
  read: iReadPage,
): Promise<Pick<iStagedPage, 'url' | 'title' | 'html' | 'markdown'>> {
  const html = pageHtml(read)
  if (html !== null)
    return { url: read.url, title: inspectHtml(html, read.url).title, html }
  const bytes = pageBytes(read)
  const format = detectDocumentFormat({
    bytes,
    mimeType: read.contentType,
    fileName: read.url,
  })
  if (format)
    return {
      url: read.url,
      title: source.title ?? read.url,
      markdown: await extractDocumentText(bytes, format, { url: read.url }),
    }
  throw new DocumentUnreadableError(
    unreadableReason({ bytes, mimeType: read.contentType, fileName: read.url }),
  )
}

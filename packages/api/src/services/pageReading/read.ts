import { and, eq, gte, inArray, or, sql } from 'drizzle-orm'
import { knowledgeConfig } from '../../config/knowledge.config'
import { db } from '../../db'
import { aiUsageEvent, knowledgeSource } from '../../db/schema'
import { env } from '../../env'
import { judgeResponse, looksLikeHtml } from './content'
import { pageReaderProviders } from './providers'
import {
  PageBlockedError,
  PageNotFoundError,
  PageReadCostError,
  PageReadError,
  type iReadPage,
  type tReadKind,
} from './types'

export { isBlockedPage, judgeResponse } from './content'
export {
  PageBlockedError,
  PageNotFoundError,
  PageReadCostError,
  PageReadError,
  type iReadPage,
  type tReadKind,
} from './types'

const settings = knowledgeConfig.pageReading

export interface iReadOptions {
  kind: tReadKind
  /**
   * Who pays: every billed attempt is recorded against this workspace and
   * source. Only scripts without a workspace leave it out.
   */
  usage?: { organizationId: string; sourceId?: string }
  /** The website read this belongs to, for its spending cap. */
  websiteRead?: { websiteId: string; startedAt: Date }
}

// What this website read has spent on reading so far: its own and its
// pages' records since it started.
async function websiteReadSpend(
  organizationId: string,
  websiteRead: NonNullable<iReadOptions['websiteRead']>,
) {
  const pages = db
    .select({ id: knowledgeSource.id })
    .from(knowledgeSource)
    .where(
      or(
        eq(knowledgeSource.id, websiteRead.websiteId),
        eq(knowledgeSource.parentId, websiteRead.websiteId),
      ),
    )
  const [row] = await db
    .select({
      spent: sql<string | null>`sum(${aiUsageEvent.costUsd})`,
    })
    .from(aiUsageEvent)
    .where(
      and(
        eq(aiUsageEvent.organizationId, organizationId),
        eq(aiUsageEvent.kind, 'pageRead'),
        gte(aiUsageEvent.createdAt, websiteRead.startedAt),
        inArray(aiUsageEvent.sourceId, pages),
      ),
    )
  return Number(row?.spent ?? 0)
}

/**
 * One address on a customer's website, read through the configured page
 * reader (never by our own server). Pages come back as HTML (a page that
 * turns out to be a file comes back as its bytes), documents as bytes,
 * sitemaps as text. The provider escalates as needed; this layer judges
 * content, enforces the spending caps and records each attempt's cost.
 * Throws PageNotFoundError (404/410), PageBlockedError (bot protection,
 * refusals, or PageReadCostError at a cap) or PageReadError.
 */
export async function readPage(
  url: string,
  options: iReadOptions,
): Promise<iReadPage> {
  const provider = pageReaderProviders[env.PAGE_READER_PROVIDER]
  const websiteSpent =
    options.usage && options.websiteRead
      ? await websiteReadSpend(
          options.usage.organizationId,
          options.websiteRead,
        )
      : 0
  let spent = 0
  let attempts = 0
  let capped = false
  const allowanceUsd = () => {
    const left = Math.min(
      settings.maxCostPerPageUsd - spent,
      options.websiteRead
        ? settings.maxCostPerWebsiteReadUsd - websiteSpent - spent
        : Infinity,
    )
    if (left <= 0) capped = true
    return left
  }
  const result = await provider
    .read(url, {
      kind: options.kind,
      allowanceUsd,
      judge: (response) => judgeResponse(options.kind, response),
      async recordAttempt({ name, costUsd }) {
        attempts += 1
        spent += costUsd
        if (!options.usage || costUsd <= 0) return
        await db.insert(aiUsageEvent).values({
          ...options.usage,
          kind: 'pageRead',
          provider: provider.id,
          model: name,
          costUsd: costUsd.toFixed(10),
        })
      },
    })
    .catch((error: unknown) => {
      throw new PageReadError(
        error instanceof Error ? error.message : 'The page could not be read',
      )
    })
  if (result.outcome === 'read')
    return {
      ...result.response,
      readBy: `${provider.id}:${result.attempt}`,
      attempts,
      costUsd: spent,
    }
  if (result.outcome === 'notFound') throw new PageNotFoundError(result.status)
  if (result.outcome === 'capped' || (result.outcome === 'blocked' && capped)) {
    console.warn(
      'Page read stopped at its spending cap',
      new URL(url).host,
      spent.toFixed(6),
    )
    throw new PageReadCostError()
  }
  if (result.outcome === 'blocked') throw new PageBlockedError()
  throw new PageReadError(result.reason)
}

/** A page's HTML, or null when the read returned a file instead. */
export function pageHtml(page: iReadPage) {
  return page.content.format === 'text' && looksLikeHtml(page)
    ? page.content.text
    : null
}

/** Any read as text (sitemaps, robots.txt, feeds). */
export function pageText(page: iReadPage) {
  return page.content.format === 'text'
    ? page.content.text
    : new TextDecoder().decode(page.content.bytes)
}

/** Any read as bytes (documents). */
export function pageBytes(page: iReadPage) {
  return page.content.format === 'bytes'
    ? page.content.bytes
    : new TextEncoder().encode(page.content.text)
}

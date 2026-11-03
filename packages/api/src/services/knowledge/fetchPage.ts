import type { knowledgeSource } from '../../db/schema'
import { ApiError } from '../http/apiError'
import { isCurrentContentHash } from './cleanup/formatBlocks'
import { PageUnavailableError } from './pageFailure'
import type { iStagedPage } from './staging'
import {
  detectDocumentFormat,
  DocumentUnreadableError,
  extractDocumentText,
  unreadableReason,
} from './documents'
import { inspectHtml, fetchPublicUrl, readLimited } from './web'
import { assertPageScope } from './pageScope'
import { sourceScope } from './sourceScope'
import {
  isBlockedPage,
  loadPage,
  PageBlockedError,
  PageNotFoundError,
  pageLoadersConfigured,
} from './pageLoaders'

type tValidators = NonNullable<iStagedPage['httpValidators']>

export type tWebsitePage =
  | { kind: 'unchanged'; url: string; httpValidators: tValidators }
  | {
      kind: 'html'
      url: string
      html: string
      /** A page loader's name, or "plain". */
      loadedBy: string
      httpValidators: tValidators
    }
  | {
      kind: 'file'
      url: string
      bytes: Uint8Array
      type: string
      httpValidators: tValidators
    }

/**
 * One website page. A plain request first: it answers "unchanged" (304) and
 * serves documents such as PDFs. HTML, or a refused plain request, is loaded
 * again through the page loaders (a browser, so scripts run and robots.txt
 * doesn't apply) when one is configured; failing that, the plain HTML. A
 * bot-protection page is never taken as content.
 */
export async function loadWebsitePage(
  url: string,
  {
    headers = {},
    checkUrl = () => undefined,
  }: {
    headers?: Record<string, string>
    /** Throws when a final address (after redirects) may not be read. */
    checkUrl?: (url: string) => void
  } = {},
): Promise<tWebsitePage> {
  const browser = pageLoadersConfigured()
  let plain: Awaited<ReturnType<typeof fetchPublicUrl>> | undefined
  let failure: unknown
  try {
    plain = await fetchPublicUrl(url, headers)
  } catch (error) {
    // An address we may not read never goes to a page loader either.
    if (error instanceof ApiError || !browser) throw error
    failure = error
  }
  let plainHtml: { url: string; html: string } | undefined
  let blocked = false
  let httpValidators: tValidators = { etag: null, lastModifiedHeader: null }
  if (plain) {
    const { response } = plain
    try {
      checkUrl(plain.url)
    } catch (error) {
      await response.body?.cancel()
      throw error
    }
    httpValidators = {
      etag: response.headers.get('etag'),
      lastModifiedHeader: response.headers.get('last-modified'),
    }
    if (response.status === 304) {
      await response.body?.cancel()
      return { kind: 'unchanged', url: plain.url, httpValidators }
    }
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel()
      throw new PageUnavailableError(response.status)
    }
    if (response.ok) {
      const type = response.headers.get('content-type') ?? ''
      const bytes = await readLimited(response)
      if (!type.includes('text/html'))
        return { kind: 'file', url: plain.url, bytes, type, httpValidators }
      plainHtml = { url: plain.url, html: new TextDecoder().decode(bytes) }
    } else {
      await response.body?.cancel()
      failure = new Error(`Page returned HTTP ${response.status}`)
      blocked = response.status === 403
      httpValidators = { etag: null, lastModifiedHeader: null }
      if (!browser) throw failure
    }
  }
  if (browser) {
    const page = await loadPage(plainHtml?.url ?? plain?.url ?? url).catch(
      (error: unknown) => {
        if (error instanceof PageNotFoundError)
          throw new PageUnavailableError(error.status)
        if (error instanceof PageBlockedError) blocked = true
        else if (!plainHtml) failure = error
        return null
      },
    )
    if (page) {
      checkUrl(page.url)
      return { kind: 'html', ...page, httpValidators }
    }
  }
  if (plainHtml && !isBlockedPage(plainHtml.html))
    return { kind: 'html', ...plainHtml, loadedBy: 'plain', httpValidators }
  if (blocked || plainHtml) throw new PageBlockedError()
  throw failure
}

// Fetch an unstaged page or confirm a provider checkpoint against the website.
// Force a full response when old staged content cannot be prepared again.
export async function fetchPage(
  source: typeof knowledgeSource.$inferSelect,
  { force = false }: { force?: boolean } = {},
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
  const loaded = await loadWebsitePage(url, {
    headers: {
      ...(known && source.etag ? { 'if-none-match': source.etag } : {}),
      ...(known && source.lastModifiedHeader
        ? { 'if-modified-since': source.lastModifiedHeader }
        : {}),
    },
    checkUrl: (finalUrl) => assertPageScope(scope, finalUrl),
  })
  if (loaded.kind === 'unchanged') {
    if (force || !isCurrentContentHash(source.contentHash) || source.archivedAt)
      throw new Error('Page returned HTTP 304')
    return {
      page: {
        url: loaded.url,
        title: source.title ?? loaded.url,
        httpValidators: {
          etag: loaded.httpValidators.etag ?? source.etag,
          lastModifiedHeader:
            loaded.httpValidators.lastModifiedHeader ??
            source.lastModifiedHeader,
        },
      },
      unchanged: true,
    }
  }
  const { httpValidators } = loaded
  if (loaded.kind === 'html')
    return {
      page: {
        url: loaded.url,
        title: inspectHtml(loaded.html, loaded.url).title,
        html: loaded.html,
        httpValidators,
      },
      unchanged: false,
    }
  const { bytes, type, url: finalUrl } = loaded
  const format = detectDocumentFormat({
    bytes,
    mimeType: type,
    fileName: finalUrl,
  })
  if (format)
    return {
      page: {
        url: finalUrl,
        title: source.title ?? finalUrl,
        markdown: await extractDocumentText(bytes, format, { url: finalUrl }),
        httpValidators,
      },
      unchanged: false,
    }
  throw new DocumentUnreadableError(
    unreadableReason({ bytes, mimeType: type, fileName: finalUrl }),
  )
}

import * as cheerio from 'cheerio'
import { knowledgeConfig } from '../../config/knowledge.config'
import type { iReaderResponse, tReadKind, tVerdict } from './types'

// Bot protection answers with a page of its own ("Just a moment...") rather
// than the website. That page is a failure to read, never content.
const blockedTitle =
  /^(?:just a moment|attention required|access denied|error: the request could not be satisfied|pardon our interruption)|access to .{1,200} (?:was|is|has been) denied/i

export function isBlockedPage(html: string, status?: number) {
  const $ = cheerio.load(html)
  if (blockedTitle.test($('title').first().text().trim())) return true
  if (status !== 403) return false
  $('script, style, noscript').remove()
  return $('body').text().replace(/\s+/g, ' ').trim().length < 1000
}

// Cookie and consent banners are not the page, so their text doesn't count.
const bannerSelector = [
  '[id*="cookie" i]',
  '[class*="cookie" i]',
  '[id*="consent" i]',
  '[class*="consent" i]',
  '[id*="gdpr" i]',
  '[class*="gdpr" i]',
].join(', ')

/** Characters of text a visitor would read, without code or banners. */
export function readableTextLength(html: string) {
  const $ = cheerio.load(html)
  $('script, style, noscript, template, svg, iframe').remove()
  // A body class such as "cookie-accepted" isn't a banner, nor is a wrapper
  // holding the whole page.
  $(bannerSelector)
    .not('html, body, main')
    .filter((_, element) => $(element).text().length < 3000)
    .remove()
  return $('body').text().replace(/\s+/g, ' ').trim().length
}

export const looksLikeHtml = (response: iReaderResponse) =>
  response.content.format === 'text' &&
  (/html/i.test(response.contentType) ||
    /^\s*<(?:!doctype html|html)/i.test(response.content.text.slice(0, 512)))

/**
 * Whether a response is content, provider-neutral: a missing page, a refusal
 * or bot challenge, another HTTP failure, or, for a web page, too little
 * readable text (an app shell or a cookie banner) to be the page.
 */
export function judgeResponse(
  kind: tReadKind,
  response: iReaderResponse,
): tVerdict {
  const { status } = response
  if (status === 404 || status === 410) return { verdict: 'notFound', status }
  const html = looksLikeHtml(response)
  if (
    html &&
    response.content.format === 'text' &&
    isBlockedPage(response.content.text, status)
  )
    return { verdict: 'blocked' }
  if ([401, 403, 429].includes(status)) return { verdict: 'blocked' }
  if (status >= 400)
    return { verdict: 'failed', reason: `Page returned HTTP ${status}` }
  if (
    kind === 'page' &&
    html &&
    response.content.format === 'text' &&
    readableTextLength(response.content.text) <
      knowledgeConfig.pageReading.minPageTextChars
  )
    return { verdict: 'thin' }
  return { verdict: 'real' }
}

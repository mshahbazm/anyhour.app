import * as cheerio from 'cheerio'

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

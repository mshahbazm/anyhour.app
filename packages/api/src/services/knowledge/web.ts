import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import * as cheerio from 'cheerio'
import { XMLParser } from 'fast-xml-parser'
import { ApiError } from '../http/apiError'
import {
  pageText,
  PageNotFoundError,
  readPage,
  type iReadOptions,
} from '../pageReading/read'

const trackingParams = new Set(['fbclid', 'gclid', 'msclkid'])

export function normalizeUrl(value: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol))
    throw new ApiError(
      422,
      'invalid_url',
      'Only HTTP and HTTPS URLs are supported',
    )
  if (url.username || url.password)
    throw new ApiError(
      422,
      'invalid_url',
      'URLs with credentials are unsupported',
    )
  url.hash = ''
  url.hostname = url.hostname.toLowerCase()
  // "/index.html" is the same page as "/": learn and cite it once.
  url.pathname = url.pathname.replace(
    /\/(?:index|default)\.(?:html?|php|aspx?)$/i,
    '/',
  )
  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  )
    url.port = ''
  for (const key of [...url.searchParams.keys()]) {
    if (
      key.toLowerCase().startsWith('utm_') ||
      trackingParams.has(key.toLowerCase())
    )
      url.searchParams.delete(key)
  }
  url.searchParams.sort()
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '')
  return url.toString()
}

export function isSameWebsite(first: string, second: string) {
  const firstUrl = new URL(first)
  const secondUrl = new URL(second)
  return (
    firstUrl.hostname.replace(/^www\./, '') ===
      secondUrl.hostname.replace(/^www\./, '') &&
    firstUrl.port === secondUrl.port &&
    !(firstUrl.protocol === 'https:' && secondUrl.protocol === 'http:')
  )
}

function isPrivateIp(ip: string) {
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice(7)
    if (isIP(mapped) === 4) return isPrivateIp(mapped)
    const parts = mapped.split(':')
    if (parts.length === 2) {
      const value = `${parseInt(parts[0], 16) >> 8}.${parseInt(parts[0], 16) & 255}.${parseInt(parts[1], 16) >> 8}.${parseInt(parts[1], 16) & 255}`
      return isPrivateIp(value)
    }
  }
  const firstIpv6 = Number.parseInt(ip.split(':')[0] ?? '', 16)
  if (
    ip === '::1' ||
    ip === '::' ||
    (firstIpv6 >= 0xfc00 && firstIpv6 <= 0xfdff) ||
    (firstIpv6 >= 0xfe80 && firstIpv6 <= 0xfebf)
  )
    return true
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      // Only 192.0.0.0/24 and 192.0.2.0/24 are reserved; the rest of 192.0
      // is public (WordPress VIP hosts sites on 192.0.66.x).
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  return false
}

async function resolveFetchable(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol))
    throw new ApiError(
      422,
      'invalid_url',
      'Only HTTP and HTTPS URLs are supported',
    )
  if (url.username || url.password)
    throw new ApiError(
      422,
      'invalid_url',
      'URLs with credentials are unsupported',
    )
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = await lookup(hostname, { all: true })
  const localTest =
    process.env.NODE_ENV === 'test' &&
    ['localhost', '127.0.0.1'].includes(url.hostname)
  if (
    !addresses.length ||
    (!localTest && addresses.some(({ address }) => isPrivateIp(address)))
  ) {
    throw new ApiError(422, 'blocked_url', 'This address cannot be crawled')
  }
  // IPv4 first: a server without an IPv6 route would wait on it forever.
  return addresses.find(({ family }) => family === 4) ?? addresses[0]
}

export async function assertFetchableUrl(value: string) {
  await resolveFetchable(new URL(normalizeUrl(value)))
}

export function inspectHtml(html: string, pageUrl: string) {
  const $ = cheerio.load(html)
  let baseUrl = pageUrl
  try {
    const base = new URL(
      $('base[href]').first().attr('href') ?? pageUrl,
      pageUrl,
    )
    if (['http:', 'https:'].includes(base.protocol)) baseUrl = base.href
  } catch {
    /* An invalid base does not invalidate the page's links. */
  }
  const title =
    $('title').first().text().trim() || $('h1').first().text().trim() || pageUrl
  const links = $('a[href]')
    .map((_, element) => {
      try {
        return normalizeUrl(
          new URL($(element).attr('href') ?? '', baseUrl).toString(),
        )
      } catch {
        return null
      }
    })
    .get()
  return { title, links }
}

const xmlParser = new XMLParser({ ignoreAttributes: false })

/** Who pays for reading a website's sitemaps (pageReading/read.ts). */
export type tSitemapRead = Omit<iReadOptions, 'kind'>

// A small text file of the website (sitemap, robots.txt, feed), or null when
// it isn't there.
export async function readSiteFile(url: string, read: tSitemapRead) {
  try {
    return pageText(await readPage(url, { ...read, kind: 'sitemap' }))
  } catch (error) {
    if (error instanceof PageNotFoundError) return null
    throw error
  }
}

export async function discoverSitemap(siteUrl: string, read: tSitemapRead) {
  const pages = await discoverSitemapPages(siteUrl, read)
  return [...new Set([...pages.keys(), normalizeUrl(siteUrl)])]
}

// Each page the sitemaps list, with the sitemap that listed it: its name
// ("post-sitemap.xml") says what kind of pages it holds.
// Some sitemaps list an https site's pages as http://; read them as https.
function sameProtocol(root: URL, value: string) {
  return root.protocol === 'https:'
    ? value.replace(/^http:\/\//i, 'https://')
    : value
}

export async function discoverSitemapPages(
  siteUrl: string,
  read: tSitemapRead,
) {
  const root = new URL(siteUrl)
  const pending = [
    new URL('/sitemap.xml', root).toString(),
    new URL('/sitemap_index.xml', root).toString(),
  ]
  const seen = new Set<string>()
  const pages = new Map<string, string>()
  try {
    const robots = await readSiteFile(
      new URL('/robots.txt', root).toString(),
      read,
    )
    if (robots) {
      for (const match of robots.matchAll(/^sitemap:\s*(\S+)/gim)) {
        try {
          const url = normalizeUrl(match[1])
          if (isSameWebsite(root.toString(), url)) pending.push(url)
        } catch {
          // Ignore malformed sitemap references.
        }
      }
    }
  } catch {
    // The website can still be discovered from its links.
  }
  while (pending.length) {
    if (seen.size >= 100 || pages.size >= 50_000)
      throw new Error('Website sitemap exceeds the technical discovery limit')
    const value = pending.shift()!
    if (seen.has(value)) continue
    seen.add(value)
    try {
      const text = await readSiteFile(value, read)
      if (!text) continue
      const document = xmlParser.parse(text) as {
        sitemapindex?: { sitemap?: { loc: string } | Array<{ loc: string }> }
        urlset?: { url?: { loc: string } | Array<{ loc: string }> }
      }
      const sitemaps = document.sitemapindex?.sitemap
      for (const entry of sitemaps ? [sitemaps].flat() : []) {
        try {
          const url = normalizeUrl(sameProtocol(root, entry.loc))
          if (isSameWebsite(root.toString(), url)) pending.push(url)
        } catch {
          // Ignore one malformed entry without discarding the sitemap.
        }
      }
      const urls = document.urlset?.url
      for (const entry of urls ? [urls].flat() : []) {
        try {
          const url = normalizeUrl(sameProtocol(root, entry.loc))
          if (isSameWebsite(root.toString(), url) && !pages.has(url))
            pages.set(url, value)
        } catch {
          // Ignore one malformed entry without discarding the sitemap.
        }
      }
    } catch {
      /* A missing or invalid sitemap falls back to links. */
    }
  }
  if (pages.size >= 50_000)
    throw new Error('Website sitemap exceeds the technical discovery limit')
  return pages
}

// Paths hosting providers use for their own machinery, never business
// content: Cloudflare turns email addresses into /cdn-cgi/l/email-protection
// links, which 404 when fetched.
const providerPaths = ['/cdn-cgi/']

// A path rule is a prefix ("/blog" covers "/blog" and everything under it),
// or one page when it ends in "$" ("/my-post$" is that page only).
export function exactRulePath(rule: string) {
  return rule.endsWith('$') ? rule.slice(0, -1) : null
}

export function ruleMatches(path: string, rule: string) {
  const exact = exactRulePath(rule)
  if (exact === null) return path.startsWith(rule)
  const trim = (value: string) =>
    value.length > 1 ? value.replace(/\/$/, '') : value
  return trim(path) === trim(exact)
}

export function pathAllowed(
  value: string,
  includes: string[],
  excludes: string[],
) {
  const path = new URL(value).pathname
  if (providerPaths.some((prefix) => path.startsWith(prefix))) return false
  return (
    (includes.length === 0 ||
      includes.some((rule) => ruleMatches(path, rule))) &&
    !excludes.some((rule) => ruleMatches(path, rule))
  )
}

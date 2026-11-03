import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import * as cheerio from 'cheerio'
import { XMLParser } from 'fast-xml-parser'
import { ApiError } from '../http/apiError'

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

async function requestPinned(url: URL, headers: Record<string, string>) {
  const address = await resolveFetchable(url)
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  const pinnedUrl = new URL(url)
  pinnedUrl.hostname =
    address.family === 6 ? `[${address.address}]` : address.address
  return new Promise<Response>((resolve, reject) => {
    const signal = AbortSignal.timeout(20_000)
    const req = request(
      pinnedUrl,
      {
        servername: url.hostname,
        headers: {
          'user-agent': 'AnyhourBot/1.0',
          ...headers,
          host: url.host,
        },
        signal,
      },
      (incoming) => {
        const responseHeaders = new Headers()
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value !== undefined)
            responseHeaders.set(
              key,
              Array.isArray(value) ? value.join(', ') : value,
            )
        }
        const status = incoming.statusCode ?? 500
        if ([204, 205, 304].includes(status)) incoming.resume()
        const body = [204, 205, 304].includes(status)
          ? null
          : (Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>)
        resolve(
          new Response(body, {
            status,
            headers: responseHeaders,
          }),
        )
      },
    )
    req.on('error', reject)
    // The signal alone doesn't stop a connection that never opens (seen
    // under Bun), and destroying the request then reports no error.
    setTimeout(() => {
      const error = new Error('Website did not answer in time')
      reject(error)
      req.destroy(error)
    }, 20_000).unref()
    req.end()
  })
}

export async function fetchPublicUrl(
  value: string,
  headers: Record<string, string> = {},
) {
  let current = new URL(normalizeUrl(value))
  for (let redirect = 0; redirect < 5; redirect += 1) {
    const response = await requestPinned(current, headers)
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new Error('Redirect without location')
      await response.body?.cancel()
      current = new URL(location, current)
      continue
    }
    // Keep the document location intact: a trailing slash changes how relative
    // links resolve. Callers normalize source identity separately.
    return { response, url: current.toString() }
  }
  throw new Error('Too many redirects')
}

export async function readLimited(
  response: Response,
  maxBytes = 10 * 1024 * 1024,
) {
  const length = Number(response.headers.get('content-length') ?? '0')
  if (length > maxBytes) {
    await response.body?.cancel()
    throw new Error('Source is too large')
  }
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error('Source is too large')
    }
    chunks.push(value)
  }
  const result = new Uint8Array(size)
  let position = 0
  for (const chunk of chunks) {
    result.set(chunk, position)
    position += chunk.length
  }
  return result
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

export async function discoverSitemap(siteUrl: string) {
  const pages = await discoverSitemapPages(siteUrl)
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

export async function discoverSitemapPages(siteUrl: string) {
  const root = new URL(siteUrl)
  const pending = [
    new URL('/sitemap.xml', root).toString(),
    new URL('/sitemap_index.xml', root).toString(),
  ]
  const seen = new Set<string>()
  const pages = new Map<string, string>()
  try {
    const { response } = await fetchPublicUrl(
      new URL('/robots.txt', root).toString(),
    )
    if (response.ok) {
      const robots = new TextDecoder().decode(
        await readLimited(response, 1024 * 1024),
      )
      for (const match of robots.matchAll(/^sitemap:\s*(\S+)/gim)) {
        try {
          const url = normalizeUrl(match[1])
          if (isSameWebsite(root.toString(), url)) pending.push(url)
        } catch {
          // Ignore malformed sitemap references.
        }
      }
    } else await response.body?.cancel()
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
      const { response } = await fetchPublicUrl(value)
      if (!response.ok) {
        await response.body?.cancel()
        continue
      }
      const document = xmlParser.parse(
        new TextDecoder().decode(await readLimited(response)),
      ) as {
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

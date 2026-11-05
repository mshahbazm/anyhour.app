import { z } from 'zod'
import { knowledgeConfig } from '../../../config/knowledge.config'
import { env, vendorKey } from '../../../env'
import type {
  iPageReaderProvider,
  iProviderReadContext,
  iReaderResponse,
  tProviderRead,
  tReadKind,
  tVerdict,
} from '../types'

// Spider (spider.cloud), POST /scrape: one page per call, never following
// links. Parameters from https://spider.cloud/docs/api (Common Parameters)
// and https://spider.cloud/llms-full.txt; the response shape and `costs`
// from the latter ("Response shape").

const defaultEndpoint = 'https://api.spider.cloud/scrape'
const settings = knowledgeConfig.pageReading

// Sent with every attempt. `cache: false` reads the website now, not
// Spider's copy (up to 2 days old by default). The owner asked us to read
// their own site, so robots.txt doesn't apply (it is on by default), as with
// the browser we used before. `return_headers` gives the content type and
// validators; `filter_output_main_only` is off so raw HTML is never trimmed.
const common = {
  cache: false,
  respect_robots: false,
  return_headers: true,
  filter_output_main_only: false,
  metadata: false,
} as const

const settle = {
  idle_network: { timeout: { secs: settings.browserSettleSeconds, nanos: 0 } },
}

// Ways of reading, cheapest first. `request: "smart"` lets Spider choose
// plain HTTP or Chrome per page; `"browser"` always renders. `stealth` is
// Spider's premium residential proxy pool for sites that turn standard IPs
// away (it bills 1.5–2× and is on by default, so it is off until needed).
const attempts = {
  smart: { request: 'smart', stealth: false },
  browser: { request: 'browser', stealth: false, wait_for: settle },
  stealth: { request: 'browser', stealth: true, wait_for: settle },
  plain: { request: 'http', stealth: false },
  plainStealth: { request: 'http', stealth: true },
} as const
type tAttempt = keyof typeof attempts

// Where each kind starts, and what follows an attempt whose response was
// thin or blocked. Pages: smart; thin, the browser; blocked (at either), the
// stealth browser. Files: plain HTTP; blocked, through stealth. A page still
// thin at the end is kept as it is.
type tNext = Partial<Record<tAttempt, { thin?: tAttempt; blocked?: tAttempt }>>
const plans: Record<tReadKind, { first: tAttempt; next: tNext }> = {
  page: {
    first: 'smart',
    next: {
      smart: { thin: 'browser', blocked: 'stealth' },
      browser: { blocked: 'stealth' },
    },
  },
  document: { first: 'plain', next: { plain: { blocked: 'plainStealth' } } },
  sitemap: { first: 'plain', next: { plain: { blocked: 'plainStealth' } } },
}

const costsSchema = z
  .object({ total_cost: z.number().nonnegative() })
  .nullable()
  .optional()
const pageSchema = z.object({
  url: z.string().optional(),
  // Absent when Spider couldn't reach the site; `error` then says why.
  content: z
    .union([z.string(), z.array(z.number().int()), z.null()])
    .optional(),
  status: z.number().int().optional(),
  error: z.string().nullable().optional(),
  headers: z.record(z.string(), z.string()).nullable().optional(),
  // null when nothing was billed.
  costs: costsSchema,
})
const responseSchema = z.array(pageSchema).min(1)

// Spider's own failures, not the website's.
class SpiderError extends Error {}

const textType = /^(?:text\/|application\/(?:[\w.+-]+\+)?(?:xml|json))/i
const headerValue = (
  headers: Record<string, string> | null | undefined,
  name: string,
) => headers?.[name] ?? null

async function scrape(
  url: string,
  attempt: tAttempt,
  format: 'raw' | 'bytes',
  allowanceUsd: number,
) {
  const apiKey = vendorKey('spider')
  if (!apiKey) throw new SpiderError('SPIDER_API_KEY is not set')
  const response = await fetch(env.SPIDER_API_URL ?? defaultEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      ...common,
      ...attempts[attempt],
      return_format: format,
      // Spider's own per-page limit, in credits (10,000 = $1).
      max_credits_per_page: Math.max(1, Math.ceil(allowanceUsd * 10_000)),
    }),
    signal: AbortSignal.timeout(settings.attemptTimeoutMs),
  }).catch((error: unknown) => {
    throw new SpiderError(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Spider did not answer in time'
        : 'Spider could not be reached',
    )
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new SpiderError(`Spider returned HTTP ${response.status}`)
  }
  const parsed = responseSchema.safeParse(
    await response.json().catch(() => null),
  )
  if (!parsed.success)
    throw new SpiderError('Spider returned an invalid response')
  const page = parsed.data[0]
  return { page, costUsd: page.costs?.total_cost ?? 0 }
}

function toResponse(
  requested: string,
  page: z.infer<typeof pageSchema>,
): iReaderResponse | { failed: string } {
  if (page.error || page.status === undefined)
    return { failed: page.error ?? 'Spider returned no status' }
  const content = page.content ?? ''
  return {
    url: page.url ?? requested,
    status: page.status,
    contentType: headerValue(page.headers, 'content-type') ?? '',
    content:
      typeof content === 'string'
        ? { format: 'text', text: content }
        : { format: 'bytes', bytes: Uint8Array.from(content) },
    validators: {
      etag: headerValue(page.headers, 'etag'),
      lastModifiedHeader: headerValue(page.headers, 'last-modified'),
    },
  }
}

const size = (response: iReaderResponse) =>
  response.content.format === 'text'
    ? response.content.text.length
    : response.content.bytes.length

export const spider: iPageReaderProvider = {
  id: 'spider',
  async read(url, context: iProviderReadContext): Promise<tProviderRead> {
    const plan = plans[context.kind]
    let attempt: tAttempt | undefined = plan.first
    let format: 'raw' | 'bytes' = context.kind === 'document' ? 'bytes' : 'raw'
    // The best thin page so far: kept when nothing fuller comes.
    let thin: { response: iReaderResponse; attempt: string } | undefined
    let last: tVerdict | undefined
    while (attempt) {
      if (context.allowanceUsd() <= 0)
        return thin ? { outcome: 'read', ...thin } : { outcome: 'capped' }
      const { page, costUsd } = await scrape(
        url,
        attempt,
        format,
        context.allowanceUsd(),
      )
      await context.recordAttempt({ name: attempt, costUsd })
      const response = toResponse(url, page)
      if ('failed' in response)
        return { outcome: 'failed', reason: response.failed }
      // A page that turned out to be a file (a PDF behind an address without
      // ".pdf"): raw text would garble it, so read its bytes once.
      if (
        format === 'raw' &&
        response.status < 400 &&
        response.contentType &&
        !/html/i.test(response.contentType) &&
        !textType.test(response.contentType)
      ) {
        format = 'bytes'
        continue
      }
      if (size(response) > settings.maxBytes)
        return { outcome: 'failed', reason: 'Source is too large' }
      last = context.judge(response)
      const next: { thin?: tAttempt; blocked?: tAttempt } =
        plan.next[attempt] ?? {}
      if (last.verdict === 'real') return { outcome: 'read', response, attempt }
      if (last.verdict === 'notFound')
        return { outcome: 'notFound', status: last.status }
      if (last.verdict === 'failed')
        return { outcome: 'failed', reason: last.reason }
      if (last.verdict === 'thin') {
        thin = { response, attempt }
        attempt = next.thin
      } else attempt = next.blocked
    }
    if (thin) return { outcome: 'read', ...thin }
    return { outcome: 'blocked' }
  },
}

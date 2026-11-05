import type { tPageReaderProviderId } from '../../config/pageReaders.config'

// A page reader turns an address on a customer's website into what the
// website serves there, without our own server ever fetching it
// (docs/pageReading.md). Features call `readPage` (read.ts); providers
// (providers/<id>.ts) are the only files that call a reading vendor.

/** What is being read: it decides how hard and in which format. */
export type tReadKind =
  /** A web page: HTML as a visitor's browser shows it. */
  | 'page'
  /** A file such as a PDF: its exact bytes. */
  | 'document'
  /** A small machine-readable text file: sitemap, robots.txt or feed. */
  | 'sitemap'

export type tReadContent =
  { format: 'text'; text: string } | { format: 'bytes'; bytes: Uint8Array }

/** One answer from the website, as a provider received it. */
export interface iReaderResponse {
  /** Where the read ended up, after redirects. */
  url: string
  /** The website's own HTTP status. */
  status: number
  /** The website's content type, '' when unknown. */
  contentType: string
  content: tReadContent
  validators: { etag: string | null; lastModifiedHeader: string | null }
}

/** The base layer's judgement of one response (read.ts `judgeResponse`). */
export type tVerdict =
  /** Content worth keeping. */
  | { verdict: 'real' }
  /** Loaded, but too little readable text: a shell or a banner. */
  | { verdict: 'thin' }
  /** Bot protection or a refusal (401/403/429, a challenge page). */
  | { verdict: 'blocked' }
  | { verdict: 'notFound'; status: 404 | 410 }
  | { verdict: 'failed'; reason: string }

/** What the base layer gives a provider for one read. */
export interface iProviderReadContext {
  kind: tReadKind
  /** USD this read may still spend; at or below zero, stop. */
  allowanceUsd(): number
  /** Judges a response; provider-neutral, owned by the base layer. */
  judge(response: iReaderResponse): tVerdict
  /** Each billed attempt, with the cost the vendor reported. */
  recordAttempt(attempt: { name: string; costUsd: number }): Promise<void>
}

/** How a provider's read ended, after its own escalation. */
export type tProviderRead =
  | { outcome: 'read'; response: iReaderResponse; attempt: string }
  | { outcome: 'notFound'; status: 404 | 410 }
  | { outcome: 'blocked' }
  /** The allowance ran out before real content. */
  | { outcome: 'capped' }
  | { outcome: 'failed'; reason: string }

export interface iPageReaderProvider {
  id: tPageReaderProviderId
  /** Never throws for the website's answers; only for its own faults. */
  read(url: string, context: iProviderReadContext): Promise<tProviderRead>
}

/** What `readPage` returns. */
export interface iReadPage extends iReaderResponse {
  /** `<provider>:<attempt>` that served it, e.g. "spider:smart". */
  readBy: string
  /** Attempts billed, this one included. */
  attempts: number
  /** What all attempts cost, as the provider reported. */
  costUsd: number
}

// Bot protection turned every way of reading the page away. Trying again
// soon won't change that, so the page fails at once.
export class PageBlockedError extends Error {
  constructor(message = 'The website blocked reading this page') {
    super(message)
  }
}

/** A spending cap stopped the read; it fails at once, like a block. */
export class PageReadCostError extends PageBlockedError {
  constructor() {
    super('Reading this page reached its spending cap')
  }
}

export class PageNotFoundError extends Error {
  constructor(readonly status: 404 | 410) {
    super(`Page returned HTTP ${status}`)
  }
}

/** Any other failure (site down, too large, a vendor error); retried later. */
export class PageReadError extends Error {}

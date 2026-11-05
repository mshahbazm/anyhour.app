import { env } from '../env'

export const knowledgeConfig = {
  // Pages one website reads at most, sitemap and followed links together.
  maxWebsitePages: env.MAX_WEBSITE_PAGES,
  // Pages one worker reads and learns side by side.
  pagesAtOnce: 5,
  // Reading pages, sitemaps and documents through the page reader
  // (services/pageReading/, docs/pageReading.md).
  pageReading: {
    // A page with less readable text than this (scripts, styles and cookie
    // banners left out) is thin: an app shell or a page still loading, so a
    // fuller read is tried. A page that stays thin is kept as it is.
    minPageTextChars: 200,
    // Spending caps in USD, from the provider's reported costs. One page's
    // attempts together, and one website read (its pages, sitemaps and
    // robots.txt since the read started). Reaching one stops escalation and
    // fails the page as too costly.
    maxCostPerPageUsd: 0.01,
    maxCostPerWebsiteReadUsd: 2,
    // How long a browser read waits for the page's network to settle.
    browserSettleSeconds: 3,
    // One attempt's answer, browser time included.
    attemptTimeoutMs: 120_000,
    // Larger pages, files and sitemaps are not read.
    maxBytes: 10 * 1024 * 1024,
  },
  pageAttempts: 8,
  // Scanned PDFs (no selectable text) are transcribed by the chat model when small enough.
  scannedPdf: { maxPages: 30 },
  preparationLeaseMs: 20 * 60_000,
  embeddingLeaseMs: 10 * 60_000,
  groupingAttempts: 3,
  queueRetries: 2,
  queueRetryDelaySeconds: 10,
  missingPageGraceMs: 3 * 24 * 60 * 60_000,
  gonePageGraceMs: 10 * 60_000,
} as const

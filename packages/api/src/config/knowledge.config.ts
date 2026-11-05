import { env } from '../env'
import type { tPageLoaderName } from '../services/knowledge/pageLoaders/types'

export const knowledgeConfig = {
  // Pages one website reads at most, sitemap and followed links together.
  maxWebsitePages: env.MAX_WEBSITE_PAGES,
  // Pages one worker reads and learns side by side.
  pagesAtOnce: 5,
  // How website pages are loaded, tried in this order (services/knowledge/
  // pageLoaders/); ones without their keys are skipped.
  pageLoaders: ['cloudflareBrowser', 'cloudflareContent'] as tPageLoaderName[],
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

import type { tVendor } from './models.config'

// Who reads customers' websites (services/pageReading/providers/), chosen by
// PAGE_READER_PROVIDER. Each provider names the vendor whose key it needs
// (vendorKeys in models.config.ts); env.ts refuses to start without it.
// Reading thresholds and spending caps are `pageReading` in knowledge.config.ts.
export const pageReaderProviderIds = ['spider'] as const
export type tPageReaderProviderId = (typeof pageReaderProviderIds)[number]
export const pageReaderProviderVendors = {
  spider: 'spider',
} as const satisfies Record<tPageReaderProviderId, tVendor>

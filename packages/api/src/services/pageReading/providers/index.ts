import type { tPageReaderProviderId } from '../../../config/pageReaders.config'
import type { iPageReaderProvider } from '../types'
import { spider } from './spider'

// Page readers by id (PAGE_READER_PROVIDER). A new provider is one file
// beside these and one line here.
export const pageReaderProviders = {
  spider,
} as const satisfies Record<tPageReaderProviderId, iPageReaderProvider>

import type { tConnectionProvider } from '../../db/schema/product/connection'
import { slackProvider } from './slack'
import type { iConnectionProvider } from './types'
import { whatsappBusinessProvider } from './whatsappBusiness'

// Every outside system a workspace can connect. Only what's built is here;
// a website channel is ours, so it has no module (no install, no webhook).
export const connectionProviders: Record<
  Exclude<tConnectionProvider, 'website'>,
  iConnectionProvider
> = {
  slack: slackProvider,
  whatsapp_business: whatsappBusinessProvider,
}

export function providerFor(id: string) {
  return Object.hasOwn(connectionProviders, id)
    ? connectionProviders[id as keyof typeof connectionProviders]
    : null
}

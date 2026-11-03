import type { tConnectionProvider } from '../db/schema/product/connection'

// What each connection is called as a channel (docs/yourAi.md, "Channels").
export const channelNames: Record<tConnectionProvider, string> = {
  website: 'Website chat',
  whatsapp_business: 'WhatsApp',
  slack: 'Slack',
}

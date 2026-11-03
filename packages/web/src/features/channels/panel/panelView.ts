import { customerChannels, isCustomerChannel } from '../api'
import type { iConnection, iConnectionList, tCustomerChannel } from '../api'

export type tWebsiteView = 'preview' | 'install' | 'insights'
export type tPanelChannel = iConnection & { provider: tCustomerChannel }

/** What the panel beside the AI's chat shows: one of its channels (null:
 * its first), and for a website, which of Preview · Install · Insights. */
export interface iPanelView {
  channelId: string | null
  website: tWebsiteView
}

/** The customer channels the AI answers: websites, then WhatsApp. */
export function aiChannels(list: iConnectionList | null): tPanelChannel[] {
  if (!list) return []
  return list.connections
    .filter(isCustomerChannel)
    .sort(
      (a, b) =>
        customerChannels.indexOf(a.provider) -
        customerChannels.indexOf(b.provider),
    )
}

// Links open the AI's chat with the panel on one view, named in the
// address: /#website-install. The hash is read once, then cleared.
const hashes = {
  website: ['website', 'preview'],
  'website-install': ['website', 'install'],
  'website-insights': ['website', 'insights'],
  whatsapp: ['whatsapp_business', 'preview'],
} as const satisfies Record<string, [tCustomerChannel, tWebsiteView]>
export type tPanelHash = keyof typeof hashes

export function panelFromHash(
  hash: string,
  channels: tPanelChannel[],
): iPanelView | null {
  if (!Object.hasOwn(hashes, hash)) return null
  const [provider, website] = hashes[hash as tPanelHash]
  return {
    channelId: channels.find((item) => item.provider === provider)?.id ?? null,
    website,
  }
}

const buttonNames: Record<tCustomerChannel, string> = {
  website: 'Website',
  whatsapp_business: 'WhatsApp',
}

/** The header button that opens the panel: the channel's name, or "Channels". */
export function panelButtonLabel(channels: tPanelChannel[]) {
  const only = channels.length === 1 ? channels[0] : undefined
  return only ? buttonNames[only.provider] : 'Channels'
}

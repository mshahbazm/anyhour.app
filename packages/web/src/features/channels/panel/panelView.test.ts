import { describe, expect, test } from 'bun:test'
import { worksOnSummary } from '../api'
import type { iConnection, iConnectionList } from '../api'
import { aiChannels, panelButtonLabel, panelFromHash } from './panelView'

function connection(
  id: string,
  provider: iConnection['provider'],
): iConnection {
  return {
    id,
    provider,
    externalAccountId: provider === 'website' ? 'https://a.com' : id,
    status: 'active',
    accountName: null,
    alertsChannelId: null,
    alertsChannelName: null,
    phoneNumber: null,
    templateName: null,
    lastError: null,
    linkedMembers: 0,
    youLinked: false,
    createdAt: '2026-10-31T00:00:00.000Z',
  }
}

const list: iConnectionList = {
  available: {
    slack: true,
    whatsappBusiness: true,
  },
  connections: [
    connection('whatsapp', 'whatsapp_business'),
    connection('slack', 'slack'),
    connection('site', 'website'),
  ],
}

describe('the channel panel', () => {
  test('lists the customer channels, websites first', () => {
    expect(aiChannels(list).map((item) => item.id)).toEqual([
      'site',
      'whatsapp',
    ])
    expect(aiChannels(null)).toEqual([])
  })

  test('opens on the view a link names', () => {
    const channels = aiChannels(list)
    expect(panelFromHash('website-install', channels)).toEqual({
      channelId: 'site',
      website: 'install',
    })
    expect(panelFromHash('website-insights', channels)?.website).toBe(
      'insights',
    )
    expect(panelFromHash('whatsapp', channels)?.channelId).toBe('whatsapp')
    // A channel that isn't set up still opens the panel, on its first.
    expect(panelFromHash('whatsapp', [])?.channelId).toBeNull()
    expect(panelFromHash('how-i-talk', channels)).toBeNull()
  })

  test('names the button after the only channel', () => {
    expect(panelButtonLabel(aiChannels(list).slice(0, 1))).toBe('Website')
    expect(panelButtonLabel(aiChannels(list))).toBe('Channels')
    expect(panelButtonLabel([])).toBe('Channels')
  })
})

test('the header line names where customers reach the AI', () => {
  expect(worksOnSummary(list)).toBe('Website · WhatsApp')
  expect(worksOnSummary(null)).toBeNull()
})

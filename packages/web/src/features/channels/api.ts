import { api } from '../workspace/api'

// Workspace API keys: the WordPress plugin uses one to re-read the site.
export interface iApiKey {
  id: string
  name: string
  keyPrefix: string
  lastUsedAt: string | null
  createdAt: string
}

const base = (organizationId: string) => `/api/organizations/${organizationId}`

export const listApiKeys = async (organizationId: string) =>
  (await api<{ apiKeys: iApiKey[] }>(`${base(organizationId)}/api-keys`))
    .apiKeys

/** The full key comes back once, on create. */
export const createApiKey = (organizationId: string, name: string) =>
  api<iApiKey & { key?: string }>(`${base(organizationId)}/api-keys`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })

export const deleteApiKey = (organizationId: string, apiKeyId: string) =>
  api<void>(
    `${base(organizationId)}/api-keys/${encodeURIComponent(apiKeyId)}`,
    { method: 'DELETE' },
  )

// Personal WhatsApp agents, one per person, talking as the AI
// (packages/api src/types/whatsapp.types.ts). Keys are write-only.
export interface iWhatsappAgent {
  id: string
  status: 'waiting_for_hi' | 'linked' | 'broken'
  memberId: string | null
  memberName: string | null
  mine: boolean
  linkedAt: string | null
  lastError: string | null
}
export interface iWhatsappAgents {
  agents: iWhatsappAgent[]
}

export const getWhatsapp = (organizationId: string) =>
  api<iWhatsappAgents>(`${base(organizationId)}/whatsapp`)

export const connectWhatsapp = (
  organizationId: string,
  input: { token: string },
) =>
  api<iWhatsappAgents>(`${base(organizationId)}/whatsapp`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

/** "Send me a test": one message from the agent to its own member. */
export const testWhatsapp = (organizationId: string, agentId: string) =>
  api<void>(
    `${base(organizationId)}/whatsapp/${encodeURIComponent(agentId)}/test`,
    { method: 'POST' },
  )

export const disconnectWhatsapp = (organizationId: string, agentId: string) =>
  api<void>(`${base(organizationId)}/whatsapp/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
  })

// Slack, the business's websites and its WhatsApp number (packages/api
// src/types/connection.types.ts).
export type tTeamChatProvider = 'slack'
/** Where customers reach the business; the AI answers each. */
export type tCustomerChannel = 'website' | 'whatsapp_business'
export const customerChannels: tCustomerChannel[] = [
  'website',
  'whatsapp_business',
]
export const channelNames: Record<tCustomerChannel, string> = {
  website: 'Website chat',
  whatsapp_business: 'WhatsApp',
}
export interface iConnection {
  id: string
  provider: tTeamChatProvider | tCustomerChannel
  /** Website: the site's origin; otherwise the provider's account id. */
  externalAccountId: string
  status: 'pending' | 'active' | 'broken' | 'disconnected'
  /** Website: whether the chat code was seen loading there. */
  installStatus?: 'working' | 'notAllowed' | 'notLive' | null
  lastSeenAt?: string | null
  accountName: string | null
  alertsChannelId: string | null
  alertsChannelName: string | null
  /** WhatsApp Business: the number customers write to. */
  phoneNumber: string | null
  /** WhatsApp Business: the template for replies after 24 hours. */
  templateName: string | null
  lastError: string | null
  linkedMembers: number
  youLinked: boolean
  createdAt: string
}
export interface iConnectionList {
  available: Record<tTeamChatProvider, boolean> & {
    whatsappBusiness: boolean
  }
  connections: iConnection[]
}
export interface iConnectionChannel {
  id: string
  name: string
}

export const getConnections = (organizationId: string) =>
  api<iConnectionList>(`${base(organizationId)}/connections`)

/** Where to send the browser to add our app; it comes back to Channels. */
export const startInstall = (
  organizationId: string,
  provider: tTeamChatProvider,
) =>
  api<{ url: string }>(
    `${base(organizationId)}/connections/${provider}/install`,
    { method: 'POST' },
  )

export const updateConnection = (
  organizationId: string,
  connectionId: string,
  input: {
    alertsChannelId?: string | null
    templateName?: string | null
    templateLanguage?: string
  },
) =>
  api<iConnectionList>(
    `${base(organizationId)}/connections/${encodeURIComponent(connectionId)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  )

/** The business's WhatsApp number for customers, pasted from Meta. */
export const connectWhatsappBusiness = (
  organizationId: string,
  input: {
    phoneNumberId: string
    businessAccountId: string
    accessToken: string
  },
) =>
  api<iConnectionList>(
    `${base(organizationId)}/connections/whatsapp_business`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )

export function isCustomerChannel(
  connection: iConnection,
): connection is iConnection & { provider: tCustomerChannel } {
  return (customerChannels as string[]).includes(connection.provider)
}

/** "yourbusiness.com" for a website channel, else the channel's name. */
export function channelLabel(connection: iConnection) {
  if (connection.provider !== 'website')
    return isCustomerChannel(connection)
      ? channelNames[connection.provider]
      : connection.provider
  try {
    return new URL(connection.externalAccountId).host.replace(/^www\./, '')
  } catch {
    return connection.externalAccountId
  }
}

const shortNames: Record<tCustomerChannel, string> = {
  website: 'Website',
  whatsapp_business: 'WhatsApp',
}

/** Where customers reach the AI, in a few words: "Website · WhatsApp"; null when nowhere yet. */
export function worksOnSummary(list: iConnectionList | null) {
  const providers = new Set(list?.connections.map((item) => item.provider))
  const names = customerChannels
    .filter((provider) => providers.has(provider))
    .map((provider) => shortNames[provider])
  return names.length ? names.join(' · ') : null
}

export const teamChatNames: Record<tTeamChatProvider, string> = {
  slack: 'Slack',
}

export const connectionChannels = (
  organizationId: string,
  connectionId: string,
) =>
  api<iConnectionChannel[]>(
    `${base(organizationId)}/connections/${encodeURIComponent(connectionId)}/channels`,
  )

export const disconnectConnection = (
  organizationId: string,
  connectionId: string,
) =>
  api<void>(
    `${base(organizationId)}/connections/${encodeURIComponent(connectionId)}`,
    { method: 'DELETE' },
  )

// The "Link your account" page.
export interface iTeamChatLink {
  app: tTeamChatProvider
  appName: string
  accountName: string | null
  workspaceName: string
  employeeName: string | null
}

export const getTeamChatLink = (token: string) =>
  api<iTeamChatLink>(`/api/team-chat/links/${encodeURIComponent(token)}`)

export const redeemTeamChatLink = (token: string) =>
  api<iTeamChatLink>(`/api/team-chat/links/${encodeURIComponent(token)}`, {
    method: 'POST',
  })

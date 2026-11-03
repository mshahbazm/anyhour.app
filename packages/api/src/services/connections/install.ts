import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { connection } from '../../db/schema'
import type { tConnectionProvider } from '../../db/schema/product/connection'
import { env } from '../../env'
import { requirePermission } from '../auth/authorize'
import { ApiError } from '../http/apiError'
import { sealCredentials } from './credentials'
import { ConnectionError } from './errors'
import { createInstallState, readInstallState } from './installState'
import { providerFor } from './registry'
import { connectionList, ownedConnection } from './store'
import { workspaceAi } from '../assistants/workspaceAi'
import { removeWebsiteOrigin } from './website'
import type { tUpdatedConnection } from '../../types/connection.types'

// Connecting happens on Channels, never in chat: it needs OAuth. Owners and
// admins (integration:update) install our app for the workspace's AI; the
// provider sends them back to /api/connect/:provider/callback.

function availableProvider(id: string) {
  const provider = providerFor(id)
  if (!provider || !provider.available())
    throw new ApiError(
      503,
      'connection_unavailable',
      'This app isn’t available yet.',
    )
  return provider
}

const installNotOffered = () =>
  new ApiError(
    422,
    'install_unavailable',
    'This one is connected on the Channels page.',
  )

export async function startInstall(input: {
  organizationId: string
  memberId: string
  provider: string
}) {
  const provider = availableProvider(input.provider)
  if (!provider.installUrl) throw installNotOffered()
  const { id: assistantId } = await workspaceAi(input.organizationId)
  return {
    url: provider.installUrl(
      createInstallState({
        provider: provider.id,
        organizationId: input.organizationId,
        memberId: input.memberId,
        assistantId,
      }),
    ),
  }
}

const toolsPage = (query: Record<string, string>) =>
  `${env.FRONT_END_URL}/channels?${new URLSearchParams(query)}`

// The provider's redirect. Returns where to send the browser: Channels with
// the result. The signed state must belong to the signed-in member.
export async function finishInstall(
  providerId: tConnectionProvider,
  query: { code?: string; state?: string; error?: string },
  headers: Headers,
) {
  if (query.error || !query.code)
    return toolsPage({ connect: providerId, result: 'cancelled' })
  const provider = availableProvider(providerId)
  if (!provider.connect) throw installNotOffered()
  const state = readInstallState(query.state, providerId)
  const { membership } = await requirePermission(
    headers,
    state.organizationId,
    'integration',
    'update',
  )
  if (membership.id !== state.memberId)
    throw new ApiError(
      403,
      'install_state_invalid',
      'Start again from Channels.',
    )
  let connected
  try {
    connected = await provider.connect(query.code)
  } catch (error) {
    if (!(error instanceof ConnectionError)) throw error
    return toolsPage({ connect: providerId, result: 'failed' })
  }
  const [taken] = await db
    .select({ organizationId: connection.organizationId })
    .from(connection)
    .where(
      and(
        eq(connection.provider, providerId),
        eq(connection.externalAccountId, connected.externalAccountId),
      ),
    )
  if (taken && taken.organizationId !== state.organizationId)
    return toolsPage({ connect: providerId, result: 'inUse' })
  const values = {
    status: 'active' as const,
    assistantId: state.assistantId,
    credentialsEncrypted: connected.credentials
      ? sealCredentials(connected.credentials)
      : null,
    settings: connected.settings,
    connectedByMemberId: state.memberId,
    lastError: null,
  }
  await db
    .insert(connection)
    .values({
      organizationId: state.organizationId,
      provider: providerId,
      externalAccountId: connected.externalAccountId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [connection.provider, connection.externalAccountId],
      targetWhere: sql`${connection.provider} <> 'website'`,
      set: values,
    })
  return toolsPage({ connect: providerId, result: 'connected' })
}

// Each provider's own settings.
export async function updateConnection(
  organizationId: string,
  connectionId: string,
  memberId: string,
  input: {
    alertsChannelId?: string | null
    templateName?: string | null
    templateLanguage?: string
  },
): Promise<tUpdatedConnection> {
  const record = await ownedConnection(organizationId, connectionId)
  const provider =
    record.provider === 'website' ? null : availableProvider(record.provider)
  const teamChat = record.provider === 'slack'
  let settings = record.settings
  if (
    record.provider === 'whatsapp_business' &&
    input.templateName !== undefined
  )
    settings = {
      ...settings,
      templateName: input.templateName?.trim() || null,
      templateLanguage:
        input.templateLanguage ?? settings.templateLanguage ?? 'en',
    }
  if (input.alertsChannelId !== undefined && teamChat && provider) {
    let name: string | null = null
    if (input.alertsChannelId) {
      let channels
      try {
        channels = (await provider.channels?.(record)) ?? []
      } catch (error) {
        if (!(error instanceof ConnectionError)) throw error
        throw new ApiError(503, 'connection_failed', error.message)
      }
      const chosen = channels.find((item) => item.id === input.alertsChannelId)
      if (!chosen)
        throw new ApiError(
          422,
          'channel_missing',
          'Choose one of the channels listed',
        )
      name = chosen.name
    }
    settings = {
      ...settings,
      alertsChannelId: input.alertsChannelId,
      alertsChannelName: name,
    }
  }
  await db
    .update(connection)
    .set({ settings })
    .where(eq(connection.id, record.id))
  const list = await connectionList(organizationId, memberId)
  const updated = list.connections.find((item) => item.id === record.id)
  if (!updated)
    throw new ApiError(404, 'connection_missing', 'That connection isn’t here')
  return { ...updated, ...list }
}

export async function connectionChannels(
  organizationId: string,
  connectionId: string,
) {
  const record = await ownedConnection(organizationId, connectionId)
  try {
    return (await availableProvider(record.provider).channels?.(record)) ?? []
  } catch (error) {
    if (!(error instanceof ConnectionError)) throw error
    throw new ApiError(503, 'connection_failed', error.message)
  }
}

// Removes our app on their side when we can, then forgets the connection,
// its linked members and events.
export async function disconnectConnection(
  organizationId: string,
  connectionId: string,
) {
  const record = await ownedConnection(organizationId, connectionId)
  const provider = providerFor(record.provider)
  await provider?.disconnect(record).catch(() => undefined)
  await db.transaction(async (tx) => {
    await tx.delete(connection).where(eq(connection.id, record.id))
    if (record.provider === 'website') await removeWebsiteOrigin(tx, record)
  })
}

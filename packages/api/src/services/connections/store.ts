import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { teamChatAppNames } from '../../config/teamChat.config'
import { db } from '../../db'
import {
  assistant,
  connection,
  connectionMember,
  widgetInstall,
} from '../../db/schema'
import type { tConnectionStatus } from '../../db/schema/product/connection'
import { env } from '../../env'
import type {
  iConnectionList,
  iConnectionView,
} from '../../types/connection.types'
import { workspaceOwners } from '../workspace/owners'
import { sendEmail } from '../email/send'
import { ApiError } from '../http/apiError'
import { connectionProviders } from './registry'
import type { tConnection } from './types'

const maxErrorChars = 300

export async function loadConnection(connectionId: string) {
  const [row] = await db
    .select()
    .from(connection)
    .where(eq(connection.id, connectionId))
  return row ?? null
}

export async function ownedConnection(
  organizationId: string,
  connectionId: string,
) {
  const row = await loadConnection(connectionId)
  if (!row || row.organizationId !== organizationId)
    throw new ApiError(404, 'connection_missing', 'That connection isn’t here')
  return row
}

// The provider refused us (a revoked token, lost access) or removed our
// app: alerts fall back to email and the owners hear about it once, by
// email, through the same path as other alerts.
export async function markConnection(
  record: tConnection,
  status: Extract<tConnectionStatus, 'broken' | 'disconnected'>,
  message: string,
) {
  const [changed] = await db
    .update(connection)
    .set({ status, lastError: message.slice(0, maxErrorChars) })
    .where(and(eq(connection.id, record.id), ne(connection.status, status)))
    .returning()
  if (!changed) return
  const customers = record.provider === 'whatsapp_business'
  const app =
    record.provider === 'whatsapp_business'
      ? 'WhatsApp'
      : record.provider === 'website'
        ? 'Your website chat'
        : teamChatAppNames[record.provider]
  const [employee] = record.assistantId
    ? await db
        .select({ name: assistant.name })
        .from(assistant)
        .where(eq(assistant.id, record.assistantId))
    : []
  const owners = await workspaceOwners(record.organizationId)
  for (const person of owners)
    await sendEmail({
      to: person.email,
      subject: `${app} stopped working`,
      text: (customers
        ? [
            `${employee?.name ?? 'Your AI'} can’t answer customers on ${record.settings.displayPhoneNumber ?? 'your WhatsApp number'} any more: ${message}`,
            `Their messages still reach your inbox. Reconnect it on the Channels page: ${env.FRONT_END_URL}/channels`,
          ]
        : [
            `${employee?.name ?? 'Your AI'} can’t reach ${record.settings.accountName ?? `your ${app}`} any more: ${message}`,
            `I’m emailing alerts until it’s reconnected on the Channels page: ${env.FRONT_END_URL}/channels`,
          ]
      ).join('\n\n'),
      idempotencyKey: `connection-${status}:${record.id}:${Math.floor(Date.now() / 86_400_000)}:${person.memberId}`,
    }).catch((error: unknown) =>
      console.error(
        'Connection alert email failed',
        error instanceof Error ? error.name : 'Unknown error',
      ),
    )
}

export async function noteConnectionError(
  record: tConnection,
  message: string | null,
) {
  await db
    .update(connection)
    .set({ lastError: message?.slice(0, maxErrorChars) ?? null })
    .where(eq(connection.id, record.id))
}

// Channels: each provider's availability and this workspace's connections.
export async function connectionList(
  organizationId: string,
  memberId: string,
): Promise<iConnectionList> {
  const rows = await db
    .select()
    .from(connection)
    .where(eq(connection.organizationId, organizationId))
    .orderBy(asc(connection.createdAt))
  const links = rows.length
    ? await db
        .select({
          connectionId: connectionMember.connectionId,
          memberId: connectionMember.memberId,
        })
        .from(connectionMember)
        .innerJoin(connection, eq(connection.id, connectionMember.connectionId))
        .where(
          and(
            eq(connection.organizationId, organizationId),
            isNotNull(connectionMember.memberId),
          ),
        )
    : []
  // Website channels: where the chat code was seen.
  const answering = rows.flatMap((row) =>
    row.provider === 'website' && row.assistantId ? [row.assistantId] : [],
  )
  const sightings = answering.length
    ? await db
        .select({
          assistantId: widgetInstall.assistantId,
          origin: widgetInstall.origin,
          status: widgetInstall.status,
          lastSeenAt: widgetInstall.lastSeenAt,
        })
        .from(widgetInstall)
        .where(inArray(widgetInstall.assistantId, [...new Set(answering)]))
    : []
  const connections: iConnectionView[] = rows.map((row) => {
    const linked = links.filter((item) => item.connectionId === row.id)
    const seen =
      row.provider === 'website'
        ? sightings.find(
            (item) =>
              item.assistantId === row.assistantId &&
              item.origin === row.externalAccountId,
          )
        : undefined
    return {
      id: row.id,
      provider: row.provider,
      externalAccountId: row.externalAccountId,
      status: row.status,
      accountName: row.settings.accountName ?? null,
      alertsChannelId: row.settings.alertsChannelId ?? null,
      alertsChannelName: row.settings.alertsChannelName ?? null,
      phoneNumber: row.settings.displayPhoneNumber ?? null,
      templateName: row.settings.templateName ?? null,
      lastError: row.lastError,
      linkedMembers: linked.length,
      youLinked: linked.some((item) => item.memberId === memberId),
      installStatus: seen?.status ?? null,
      lastSeenAt: seen?.lastSeenAt.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }
  })
  return {
    available: {
      slack: connectionProviders.slack.available(),
      whatsappBusiness: connectionProviders.whatsapp_business.available(),
    },
    connections,
  }
}

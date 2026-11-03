import { and, eq, sql } from 'drizzle-orm'
import { teamChatConfig } from '../../config/teamChat.config'
import { db } from '../../db'
import { connection, connectionEvent } from '../../db/schema'
import type { tConnectionProvider } from '../../db/schema/product/connection'
import { enqueueTeamChat } from '../queue/boss'
import { providerFor } from './registry'
import { loadConnection } from './store'
import type { iProviderEvent } from './types'

// Inbound webhooks (POST /api/connect/:provider/webhook) and Gateway events:
// verified, stored once, acked fast, then handled by the `team-chat` job.

// Stores an event for its connection and queues it, once. Events for a Slack
// workspace no workspace connected are dropped.
export async function storeEvent(
  provider: tConnectionProvider,
  event: iProviderEvent,
) {
  const [record] = await db
    .select({ id: connection.id, status: connection.status })
    .from(connection)
    .where(
      and(
        eq(connection.provider, provider),
        eq(connection.externalAccountId, event.externalAccountId),
      ),
    )
  if (!record) return null
  const [stored] = await db
    .insert(connectionEvent)
    .values({
      connectionId: record.id,
      externalEventId: event.externalEventId,
      kind: event.kind,
      payload: event.payload,
    })
    .onConflictDoNothing()
    .returning({ id: connectionEvent.id })
  if (!stored) return null
  await enqueueTeamChat(
    { source: 'connection', eventId: stored.id },
    `${record.id}:${event.externalUserId ?? 'app'}`,
  )
  return stored.id
}

export async function receiveWebhook(providerId: string, request: Request) {
  const provider = providerFor(providerId)
  if (!provider || !provider.available())
    return new Response('Not found', { status: 404 })
  const rawBody = await request.text()
  if (!provider.verifyWebhook(request.headers, rawBody))
    return new Response('Invalid signature', { status: 401 })
  let parsed
  try {
    parsed = provider.parseWebhook(request.headers, rawBody)
  } catch {
    return new Response('Unreadable body', { status: 400 })
  }
  if ('respond' in parsed) return parsed.respond
  for (const event of parsed.events) await storeEvent(provider.id, event)
  return parsed.ack
}

// The job: hands a stored event to its provider, once.
export async function processConnectionEvent(eventId: string) {
  const [claimed] = await db
    .update(connectionEvent)
    .set({ processedAt: new Date() })
    .where(
      and(
        eq(connectionEvent.id, eventId),
        sql`${connectionEvent.processedAt} is null`,
      ),
    )
    .returning()
  if (!claimed) return
  const record = await loadConnection(claimed.connectionId)
  const provider = record ? providerFor(record.provider) : null
  if (!record || !provider) return
  try {
    await provider.handleEvent(record, {
      externalAccountId: record.externalAccountId,
      externalEventId: claimed.externalEventId,
      kind: claimed.kind as iProviderEvent['kind'],
      externalUserId: null,
      payload: claimed.payload,
    })
  } catch (error) {
    // Handled at most once: a failure is noted, never replayed.
    await db
      .update(connectionEvent)
      .set({
        error: error instanceof Error ? error.name : 'Unknown error',
      })
      .where(eq(connectionEvent.id, eventId))
    console.error(
      'Connection event failed',
      error instanceof Error ? error.name : 'Unknown error',
    )
  }
}

// Worker maintenance: handled events older than keepEventsDays go.
export async function pruneConnectionEvents() {
  const cutoff = new Date(
    Date.now() - teamChatConfig.keepEventsDays * 86_400_000,
  )
  const pruned = await db
    .delete(connectionEvent)
    .where(
      sql`${connectionEvent.id} in (
        select id from connection_event
        where processed_at is not null and received_at < ${cutoff.toISOString()}::timestamp
        limit ${teamChatConfig.pruneBatch}
      )`,
    )
    .returning({ id: connectionEvent.id })
  return pruned.length
}

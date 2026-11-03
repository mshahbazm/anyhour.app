import { sql } from 'drizzle-orm'
import { conversationTiming } from '../../config/chat.config'
import { db } from '../../db'
import { conversation } from '../../db/schema'
import { enqueueContactFacts } from '../queue/boss'

// Maintenance: open conversations quiet for the idle threshold are closed, and
// one with a contact queues the contact-facts job (owner-facing memory; this
// bot never reads it). A visitor writing again reopens the conversation
// (beginReply). Rows locked by
// a message being accepted right now are skipped and looked at next time.
export async function closeIdleConversations(now = new Date()) {
  const cutoff = new Date(
    now.getTime() - conversationTiming.closeAfterIdleMinutes * 60_000,
  )
  const closed = await db
    .update(conversation)
    .set({ status: 'closed', closedAt: now })
    .where(
      sql`${conversation.id} in (
        select id from conversation
        where status = 'open'
          and last_message_at < ${cutoff.toISOString()}::timestamp
        order by last_message_at
        limit ${conversationTiming.closeBatch}
        for update skip locked
      )`,
    )
    .returning()
  // Preview and test chats are closed too, but learn nothing.
  for (const item of closed)
    if (!item.isTest && item.contactId)
      await enqueueContactFacts(item.id, now.toISOString()).catch(
        (error: unknown) =>
          console.error(
            'Contact facts queueing failed',
            error instanceof Error ? error.name : 'Unknown error',
          ),
      )
  return closed.length
}

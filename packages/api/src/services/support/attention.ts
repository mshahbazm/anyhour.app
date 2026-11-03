import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { assistant, contact, conversation, message } from '../../db/schema'
import type { iSupportAttention } from '../../types/support.types'
import { inboxScope } from './conversations'

const listLimit = 50

// Needs you: conversations waiting for a person (a handoff, or a visitor
// writing while the team handles it). The count is the inbox badge.
export async function supportAttention(
  organizationId: string,
): Promise<iSupportAttention> {
  const scope = inboxScope(organizationId, 'needsYou')
  const lastVisitor = db
    .select({ content: sql<string>`left(${message.content}, 200)` })
    .from(message)
    .where(
      and(
        eq(message.conversationId, conversation.id),
        eq(message.role, 'visitor'),
      ),
    )
    .orderBy(desc(message.createdAt))
    .limit(1)
  const [waiting, [{ count }]] = await Promise.all([
    db
      .select({
        id: conversation.id,
        contactName: contact.name,
        assistantName: assistant.name,
        needsHumanSince: conversation.needsHumanSince,
        handledBy: conversation.handledBy,
        summary: conversation.handoffSummary,
        lastVisitorMessage: sql<string | null>`(${lastVisitor})`,
      })
      .from(conversation)
      .innerJoin(assistant, eq(assistant.id, conversation.assistantId))
      .leftJoin(contact, eq(contact.id, conversation.contactId))
      .where(scope)
      .orderBy(
        asc(conversation.needsHumanSince),
        desc(conversation.lastMessageAt),
      )
      .limit(listLimit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversation)
      .where(scope),
  ])
  return {
    conversations: waiting.map((row) => ({
      id: row.id,
      contactName: row.contactName,
      assistantName: row.assistantName,
      needsHumanSince: row.needsHumanSince?.toISOString() ?? null,
      handledBy: row.handledBy,
      wants: row.summary?.wants ?? null,
      lastVisitorMessage: row.lastVisitorMessage,
    })),
    count,
  }
}

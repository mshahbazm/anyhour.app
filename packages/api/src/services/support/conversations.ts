import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '../../db'
import {
  assistant,
  contact,
  conversation,
  lead,
  leadConversation,
  member,
  message,
  user,
} from '../../db/schema'
import type {
  iInboxConversation,
  iInboxItem,
  iInboxMessage,
  iMemberSummary,
  tInboxFilter,
} from '../../types/support.types'
import { loadConnection } from '../connections/store'
import type { tConnection } from '../connections/types'
import {
  deliverToCustomer,
  lastCustomerMessageAt,
  windowOpen,
} from '../customerWhatsapp/send'
import { ApiError } from '../http/apiError'
import { draftNoteOffer, keepNoteOffer } from './noteOffer'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type tDatabase = typeof db | tTransaction

export const inboxFilters = ['needsYou', 'aiHandling', 'closed', 'all'] as const

// The first word of a member's name: how the visitor sees them.
export const firstName = (name: string | null | undefined) =>
  name?.trim().split(/\s+/)[0] || 'The team'

async function memberSummaries(
  database: tDatabase,
  memberIds: Array<string | null>,
): Promise<Map<string, iMemberSummary>> {
  const ids = [...new Set(memberIds.filter((id): id is string => !!id))]
  if (!ids.length) return new Map()
  const rows = await database
    .select({ id: member.id, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(inArray(member.id, ids))
  return new Map(rows.map((row) => [row.id, row]))
}

// The workspace's own conversation (through its AI), not a test.
async function workspaceConversation(
  database: tDatabase,
  organizationId: string,
  conversationId: string,
) {
  const [found] = await database
    .select({ conversation, assistantName: assistant.name })
    .from(conversation)
    .innerJoin(assistant, eq(assistant.id, conversation.assistantId))
    .where(
      and(
        eq(conversation.id, conversationId),
        eq(assistant.organizationId, organizationId),
        eq(conversation.isTest, false),
      ),
    )
    .limit(1)
  if (!found)
    throw new ApiError(404, 'conversation_missing', 'Conversation not found')
  return found
}

// The conversation's leads, newest first.
export async function conversationLeadIds(
  database: tDatabase,
  conversationId: string,
) {
  const rows = await database
    .select({ leadId: leadConversation.leadId })
    .from(leadConversation)
    .innerJoin(lead, eq(lead.id, leadConversation.leadId))
    .where(
      and(
        eq(leadConversation.conversationId, conversationId),
        isNull(lead.mergedIntoLeadId),
      ),
    )
    .orderBy(desc(leadConversation.linkedAt))
  return rows.map((row) => row.leadId)
}

// Needs you: the AI handed it to a person, or the visitor wrote while the
// team handles it. A person's reply or handing it back clears it.
export function inboxScope(organizationId: string, filter: tInboxFilter) {
  const workspace = and(
    inArray(
      conversation.assistantId,
      db
        .select({ id: assistant.id })
        .from(assistant)
        .where(eq(assistant.organizationId, organizationId)),
    ),
    eq(conversation.isTest, false),
  )
  const filters: Record<tInboxFilter, SQL | undefined> = {
    needsYou: isNotNull(conversation.needsHumanSince),
    aiHandling: and(
      eq(conversation.handledBy, 'agent'),
      isNull(conversation.needsHumanSince),
      eq(conversation.status, 'open'),
    ),
    closed: and(
      eq(conversation.status, 'closed'),
      isNull(conversation.needsHumanSince),
    ),
    all: undefined,
  }
  return and(workspace, filters[filter])!
}

const lastActivity = sql`coalesce(${conversation.lastMessageAt}, ${conversation.createdAt})`

// Newest activity first; the cursor is the last conversation id shown.
export async function listInbox(
  scope: SQL,
  cursor: string | undefined,
  limit: number,
): Promise<iInboxItem[]> {
  if (cursor !== undefined) {
    const [known] = await db
      .select({ id: conversation.id })
      .from(conversation)
      .where(and(scope, eq(conversation.id, cursor)))
      .limit(1)
    if (!known) throw new ApiError(422, 'invalid_cursor', 'Cursor is invalid')
  }
  const before =
    cursor === undefined
      ? undefined
      : sql`(${lastActivity}, ${conversation.id}) < (
    select coalesce(c2.last_message_at, c2.created_at), c2.id
    from conversation c2 where c2.id = ${cursor}
  )`
  const rows = await db
    .select({
      conversation,
      assistantName: assistant.name,
      contactName: contact.name,
      contactEmail: contact.email,
      contactPhone: contact.phone,
    })
    .from(conversation)
    .innerJoin(assistant, eq(assistant.id, conversation.assistantId))
    .leftJoin(contact, eq(contact.id, conversation.contactId))
    .where(and(scope, before))
    .orderBy(desc(lastActivity), desc(conversation.id))
    .limit(limit)
  const ids = rows.map((row) => row.conversation.id)
  const lastMessages = ids.length
    ? await db
        .selectDistinctOn([message.conversationId], {
          conversationId: message.conversationId,
          role: message.role,
          content: sql<string>`left(${message.content}, 200)`,
          createdAt: message.createdAt,
        })
        .from(message)
        .where(
          and(
            inArray(message.conversationId, ids),
            ne(message.role, 'tool'),
            eq(message.status, 'completed'),
          ),
        )
        .orderBy(message.conversationId, desc(message.createdAt))
    : []
  return rows.map((row) => {
    const chat = row.conversation
    const last = lastMessages.find((item) => item.conversationId === chat.id)
    return {
      ...summaryFields(chat, row.assistantName, {
        name: row.contactName,
        email: row.contactEmail,
        phone: row.contactPhone,
      }),
      lastMessage: last
        ? {
            role: last.role as 'visitor' | 'assistant' | 'staff',
            content: last.content,
            createdAt: last.createdAt.toISOString(),
          }
        : null,
    }
  })
}

function summaryFields(
  chat: typeof conversation.$inferSelect,
  assistantName: string,
  person: { name: string | null; email: string | null; phone: string | null },
) {
  return {
    id: chat.id,
    assistantId: chat.assistantId,
    assistantName,
    channel: chat.channel,
    status: chat.status,
    handledBy: chat.handledBy,
    needsHumanSince: chat.needsHumanSince?.toISOString() ?? null,
    assignedMemberId: chat.assignedMemberId,
    contact: chat.contactId
      ? {
          id: chat.contactId,
          name: person.name,
          email: person.email,
          phone: person.phone,
        }
      : null,
    lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
    createdAt: chat.createdAt.toISOString(),
  }
}

export async function inboxConversation(
  organizationId: string,
  conversationId: string,
): Promise<iInboxConversation> {
  const { conversation: chat, assistantName } = await workspaceConversation(
    db,
    organizationId,
    conversationId,
  )
  const [person] = chat.contactId
    ? await db
        .select({
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
        })
        .from(contact)
        .where(eq(contact.id, chat.contactId))
    : []
  const [messages, leadIds] = await Promise.all([
    db
      .select()
      .from(message)
      .where(
        and(
          eq(message.conversationId, conversationId),
          ne(message.role, 'tool'),
        ),
      )
      .orderBy(asc(message.createdAt), asc(message.id)),
    conversationLeadIds(db, conversationId),
  ])
  const staff = await memberSummaries(
    db,
    messages.map((item) => item.staffMemberId),
  )
  return {
    conversation: {
      ...summaryFields(
        chat,
        assistantName,
        person ?? { name: null, email: null, phone: null },
      ),
      entryUrl: chat.entryUrl,
      closedAt: chat.closedAt?.toISOString() ?? null,
      handoffSummary: chat.handoffSummary,
      handoffDraft: chat.handoffDraft,
      leadIds,
      whatsappAskedAt: chat.whatsappAskedAt?.toISOString() ?? null,
      whatsappOpenedAt: chat.whatsappOpenedAt?.toISOString() ?? null,
    },
    messages: messages.map((item): iInboxMessage => ({
      id: item.id,
      role: item.role as iInboxMessage['role'],
      content: item.content,
      status: item.status,
      deliveryStatus: item.deliveryStatus,
      blocks: item.blocks,
      blockReply: item.blockReply,
      staff: item.staffMemberId
        ? (staff.get(item.staffMemberId) ?? null)
        : null,
      noteOffer: item.noteOffer,
      createdAt: item.createdAt.toISOString(),
    })),
  }
}

// A member replies to the visitor. The conversation is theirs from now on:
// the AI stays quiet until someone lets it continue. When the conversation
// needed them, the AI may offer to remember the answer as a note: kept on the
// reply for the inbox card, or only returned when they replied through the
// AI's chat, which asks there instead.
export async function sendStaffReply(
  organizationId: string,
  conversationId: string,
  memberId: string,
  content: string,
  noteOfferIn: 'inbox' | 'chat' = 'inbox',
) {
  // On WhatsApp the reply goes out through the Cloud API, and only as free
  // text inside the 24-hour window (or as the template after it).
  const { conversation: found } = await workspaceConversation(
    db,
    organizationId,
    conversationId,
  )
  let whatsapp: { record: tConnection; waId: string } | null = null
  if (found.channel === 'whatsapp') {
    const record = found.connectionId
      ? await loadConnection(found.connectionId)
      : null
    if (!record || record.status !== 'active' || !found.externalUserId)
      throw new ApiError(
        409,
        'whatsapp_unavailable',
        'WhatsApp isn’t connected for this number. Reconnect it on Channels.',
      )
    if (
      !windowOpen(await lastCustomerMessageAt(conversationId)) &&
      !record.settings.templateName
    ) {
      await db
        .update(conversation)
        .set({ handoffDraft: content.trim() })
        .where(eq(conversation.id, conversationId))
      throw new ApiError(
        409,
        'whatsapp_window_closed',
        'They last wrote more than 24 hours ago, so WhatsApp only allows an approved template now. Add one on Channels, or wait for them to write again. Your reply is kept as the draft.',
      )
    }
    whatsapp = { record, waId: found.externalUserId }
  }
  const { sent, neededYou } = await db.transaction(async (tx) => {
    await workspaceConversation(tx, organizationId, conversationId)
    const [chat] = await tx
      .select()
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .for('update')
    const now = new Date()
    const [saved] = await tx
      .insert(message)
      .values({
        conversationId,
        role: 'staff',
        content: content.trim(),
        staffMemberId: memberId,
        completedAt: now,
      })
      .returning()
    await tx
      .update(conversation)
      .set({
        handledBy: 'human',
        assignedMemberId: chat.assignedMemberId ?? memberId,
        needsHumanSince: null,
        handoffDraft: null,
        lastMessageAt: now,
      })
      .where(eq(conversation.id, conversationId))
    return {
      sent: saved,
      neededYou: chat.needsHumanSince !== null || chat.handledBy === 'human',
    }
  })
  const delivery = whatsapp
    ? await deliverToCustomer(
        whatsapp.record,
        { conversationId, waId: whatsapp.waId },
        sent,
      )
    : null
  // The AI's chat asks right away, so it waits for the offer. The inbox card
  // is drafted in the background; sending never waits for it.
  const offerFor = { organizationId, conversationId, replyId: sent.id }
  const noteOffer =
    neededYou && noteOfferIn === 'chat' ? await draftNoteOffer(offerFor) : null
  if (neededYou && noteOfferIn === 'inbox')
    void keepNoteOffer(offerFor).catch((error: unknown) =>
      console.error(
        'Note offer failed',
        error instanceof Error ? error.name : 'Unknown error',
      ),
    )
  const [author] = await db
    .select({ id: member.id, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.id, memberId))
  return {
    id: sent.id,
    role: 'staff' as const,
    content: sent.content,
    status: sent.status,
    deliveryStatus: delivery ? (delivery.sent ? 'sent' : 'failed') : null,
    blocks: [],
    blockReply: null,
    staff: author ?? null,
    noteOffer,
    createdAt: sent.createdAt.toISOString(),
  } satisfies iInboxMessage
}

// "Let the AI continue": it answers the visitor again.
export async function releaseConversation(
  organizationId: string,
  conversationId: string,
) {
  await workspaceConversation(db, organizationId, conversationId)
  await db
    .update(conversation)
    .set({
      handledBy: 'agent',
      assignedMemberId: null,
      needsHumanSince: null,
      handoffDraft: null,
    })
    .where(eq(conversation.id, conversationId))
  return inboxConversation(organizationId, conversationId)
}

// Staff messages the visitor hasn't seen yet, with the writer's first name
// only, and whether the team is handling the conversation.
export async function visitorUpdates(
  conversationId: string,
  after: Date | null,
) {
  const [chat] = await db
    .select({
      handledBy: conversation.handledBy,
      needsHumanSince: conversation.needsHumanSince,
    })
    .from(conversation)
    .where(eq(conversation.id, conversationId))
  const rows = await db
    .select({
      id: message.id,
      content: message.content,
      createdAt: message.createdAt,
      name: user.name,
    })
    .from(message)
    .leftJoin(member, eq(member.id, message.staffMemberId))
    .leftJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(message.conversationId, conversationId),
        eq(message.role, 'staff'),
        after
          ? sql`${message.createdAt} > ${after.toISOString()}::timestamp`
          : undefined,
      ),
    )
    .orderBy(asc(message.createdAt), asc(message.id))
    .limit(50)
  return {
    handledBy: chat?.handledBy ?? 'agent',
    waitingForTeam: Boolean(chat?.needsHumanSince),
    messages: rows.map((row) => ({
      id: row.id,
      role: 'staff' as const,
      content: row.content,
      status: 'completed' as const,
      staffName: firstName(row.name),
      citations: [],
      createdAt: row.createdAt.toISOString(),
    })),
  }
}

// First names for a conversation's staff messages, for the visitor's history.
export async function staffFirstNames(conversationId: string) {
  const rows = await db
    .select({ id: message.id, name: user.name })
    .from(message)
    .innerJoin(member, eq(member.id, message.staffMemberId))
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(message.conversationId, conversationId),
        eq(message.role, 'staff'),
      ),
    )
  return new Map(rows.map((row) => [row.id, firstName(row.name)]))
}

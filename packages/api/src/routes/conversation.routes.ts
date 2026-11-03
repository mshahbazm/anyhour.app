import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db'
import { contact, conversation, message } from '../db/schema'
import { requirePermission } from '../services/auth/authorize'
import { ownedAssistant } from '../services/auth/owned'
import { ApiError } from '../services/http/apiError'

import { readPage, pageResponse } from '../services/http/pagination'
import { validateJson } from '../services/http/validateJson'
import { staffReplySchema } from '../schemas/conversation.schema'
import {
  inboxConversation,
  inboxFilters,
  inboxScope,
  listInbox,
  releaseConversation,
  sendStaffReply,
} from '../services/support/conversations'
import { supportAttention } from '../services/support/attention'
import { clearNoteOffer } from '../services/support/noteOffer'
import type { iAttention, tInboxFilter } from '../types/support.types'

export const conversationRoutes = new Hono()

// What needs a person now: conversations waiting for the team.
conversationRoutes.get('/:organizationId/attention', async (c) => {
  const organizationId = c.req.param('organizationId')
  await requirePermission(c.req.raw.headers, organizationId, 'lead', 'read')
  const body: iAttention = {
    support: await supportAttention(organizationId),
  }
  return c.json(body)
})

// Staff-facing conversation fields; the visitor's resume token hash stays server-side.
const publicConversation = {
  id: conversation.id,
  assistantId: conversation.assistantId,
  contactId: conversation.contactId,
  knownFields: conversation.knownFields,
  entryUrl: conversation.entryUrl,
  status: conversation.status,
  createdAt: conversation.createdAt,
  lastMessageAt: conversation.lastMessageAt,
  closedAt: conversation.closedAt,
}

conversationRoutes.get(
  '/:organizationId/assistants/:assistantId/conversations',
  async (c) => {
    const { organizationId, assistantId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'read',
    )
    await ownedAssistant(organizationId, assistantId)
    const page = await readPage(
      c,
      conversation,
      conversation.id,
      conversation.createdAt,
      and(
        eq(conversation.assistantId, assistantId),
        eq(conversation.isTest, false),
      )!,
    )
    const firstVisitorMessage = db
      .select({ content: sql<string>`left(${message.content}, 200)` })
      .from(message)
      .where(
        and(
          eq(message.conversationId, conversation.id),
          eq(message.role, 'visitor'),
        ),
      )
      .orderBy(asc(message.createdAt))
      .limit(1)
    const messageCount = db
      .select({ value: count() })
      .from(message)
      .where(eq(message.conversationId, conversation.id))
    const rows = await db
      .select({
        ...publicConversation,
        preview: sql<string | null>`(${firstVisitorMessage})`,
        messageCount: sql<number>`(${messageCount})::int`,
        contactName: contact.name,
        contactEmail: contact.email,
      })
      .from(conversation)
      .leftJoin(contact, eq(contact.id, conversation.contactId))
      .where(page.where)
      .orderBy(desc(conversation.createdAt), desc(conversation.id))
      .limit(page.limit + 1)
    return pageResponse(c, rows, page.limit)
  },
)

conversationRoutes.get(
  '/:organizationId/assistants/:assistantId/conversations/:conversationId',
  async (c) => {
    const { organizationId, assistantId, conversationId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'read',
    )
    await ownedAssistant(organizationId, assistantId)
    const [record] = await db
      .select(publicConversation)
      .from(conversation)
      .where(
        and(
          eq(conversation.isTest, false),
          eq(conversation.id, conversationId),
          eq(conversation.assistantId, assistantId),
        ),
      )
      .limit(1)
    if (!record)
      throw new ApiError(404, 'conversation_missing', 'Conversation not found')
    const messages = await db
      .select()
      .from(message)
      .where(eq(message.conversationId, conversationId))
      .orderBy(asc(message.createdAt))
    return c.json({ conversation: record, messages })
  },
)

conversationRoutes.delete(
  '/:organizationId/assistants/:assistantId/conversations/:conversationId',
  async (c) => {
    const { organizationId, assistantId, conversationId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'update',
    )
    await ownedAssistant(organizationId, assistantId)
    const [deleted] = await db
      .delete(conversation)
      .where(
        and(
          eq(conversation.isTest, false),
          eq(conversation.id, conversationId),
          eq(conversation.assistantId, assistantId),
        ),
      )
      .returning({ id: conversation.id })
    if (!deleted)
      throw new ApiError(404, 'conversation_missing', 'Conversation not found')
    return c.body(null, 204)
  },
)

// The inbox: the AI's visitor conversations in the workspace, for
// the team. Filters: needsYou, aiHandling, closed, all.
conversationRoutes.get('/:organizationId/conversations', async (c) => {
  const organizationId = c.req.param('organizationId')
  await requirePermission(
    c.req.raw.headers,
    organizationId,
    'conversation',
    'read',
  )
  const filter = (c.req.query('filter') ?? 'all') as tInboxFilter
  if (!(inboxFilters as readonly string[]).includes(filter))
    throw new ApiError(422, 'invalid_filter', 'Unknown inbox filter')
  const limit = Number(c.req.query('limit') ?? '50')
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new ApiError(422, 'invalid_limit', 'Limit must be between 1 and 200')
  const rows = await listInbox(
    inboxScope(organizationId, filter),
    c.req.query('cursor'),
    limit + 1,
  )
  return pageResponse(c, rows, limit)
})

conversationRoutes.get(
  '/:organizationId/conversations/:conversationId',
  async (c) => {
    const { organizationId, conversationId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'conversation',
      'read',
    )
    return c.json(await inboxConversation(organizationId, conversationId))
  },
)

// A team member's reply, shown to the visitor with their first name.
conversationRoutes.post(
  '/:organizationId/conversations/:conversationId/messages',
  validateJson(staffReplySchema),
  async (c) => {
    const { organizationId, conversationId } = c.req.param()
    const { membership } = await requirePermission(
      c.req.raw.headers,
      organizationId,
      'conversation',
      'reply',
    )
    const { content, noteOfferIn } = c.req.valid('json')
    return c.json(
      await sendStaffReply(
        organizationId,
        conversationId,
        membership.id,
        content,
        noteOfferIn,
      ),
      201,
    )
  },
)

// "Not now" on the offer to remember a reply.
conversationRoutes.delete(
  '/:organizationId/conversations/:conversationId/messages/:messageId/note-offer',
  async (c) => {
    const { organizationId, conversationId, messageId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'conversation',
      'reply',
    )
    await clearNoteOffer(organizationId, messageId, conversationId)
    return c.body(null, 204)
  },
)

// "Let the AI continue."
conversationRoutes.post(
  '/:organizationId/conversations/:conversationId/release',
  async (c) => {
    const { organizationId, conversationId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'conversation',
      'reply',
    )
    return c.json(await releaseConversation(organizationId, conversationId))
  },
)

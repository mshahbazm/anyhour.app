import { ownedBy } from '../services/knowledge/owner'
import { readingStatus } from './knowledgeSources.routes'
import {
  answerableKinds,
  searchableSource,
} from '../services/knowledge/sourceEligibility'
import { createHash, randomBytes } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db'
import { conversation, message, knowledgeSource } from '../db/schema'
import { requirePermission } from '../services/auth/authorize'
import { ownedAssistant } from '../services/auth/owned'
import { ApiError } from '../services/http/apiError'
import { validateJson } from '../services/http/validateJson'
import { sendMessageSchema } from '../schemas/widget.schema'
import { beginReply, failReply } from '../services/chat/messages'
import { createAnswerStream } from '../services/chat/answer'
import { visitorTurn } from '../services/chat/blocks'

export const previewRoutes = new Hono()
const base = '/:organizationId/assistants/:assistantId/preview'

async function ownedPreview(
  headers: Headers,
  organizationId: string,
  assistantId: string,
  conversationId: string,
) {
  const { session } = await requirePermission(
    headers,
    organizationId,
    'assistant',
    'read',
  )
  await ownedAssistant(organizationId, assistantId)
  const [chat] = await db
    .select()
    .from(conversation)
    .where(
      and(
        eq(conversation.id, conversationId),
        eq(conversation.assistantId, assistantId),
        eq(conversation.isTest, true),
        eq(conversation.previewUserId, session.user.id),
      ),
    )
  if (!chat)
    throw new ApiError(
      404,
      'conversation_missing',
      'Preview conversation not found',
    )
  return chat
}

previewRoutes.post(`${base}/conversations`, async (c) => {
  const { organizationId, assistantId } = c.req.param()
  const { session } = await requirePermission(
    c.req.raw.headers,
    organizationId,
    'assistant',
    'read',
  )
  await ownedAssistant(organizationId, assistantId)
  const [chat] = await db
    .insert(conversation)
    .values({
      assistantId,
      isTest: true,
      previewUserId: session.user.id,
      resumeTokenHash: createHash('sha256')
        .update(randomBytes(32))
        .digest('hex'),
    })
    .returning({ id: conversation.id })
  return c.json(chat, 201)
})

previewRoutes.get(`${base}/conversations/:conversationId`, async (c) => {
  const { organizationId, assistantId, conversationId } = c.req.param()
  await ownedPreview(
    c.req.raw.headers,
    organizationId,
    assistantId,
    conversationId,
  )
  const messages = await db
    .select({
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
      citations: message.citations,
      blocks: message.blocks,
    })
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(asc(message.createdAt), asc(message.id))
  return c.json({ id: conversationId, messages })
})

previewRoutes.post(
  `${base}/conversations/:conversationId/messages`,
  validateJson(sendMessageSchema),
  async (c) => {
    const { organizationId, assistantId, conversationId } = c.req.param()
    await ownedPreview(
      c.req.raw.headers,
      organizationId,
      assistantId,
      conversationId,
    )
    const [ready] = await db
      .select({ id: knowledgeSource.id })
      .from(knowledgeSource)
      .where(
        and(
          ownedBy(knowledgeSource, { organizationId }),
          searchableSource(),
          inArray(knowledgeSource.kind, [...answerableKinds]),
        ),
      )
      .limit(1)
    if (!ready)
      throw new ApiError(
        409,
        'no_knowledge',
        'Add knowledge and wait for indexing before testing your bot',
      )
    const sent = c.req.valid('json')
    // Taps work like on the website; a private test never records a lead.
    const input = { ...sent, ...(await visitorTurn(conversationId, sent)) }
    const reply = await beginReply(conversationId, input)
    try {
      return new Response(
        await createAnswerStream(
          assistantId,
          conversationId,
          input.clientMessageId,
          reply,
          true,
        ),
        {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            'x-accel-buffering': 'no',
          },
        },
      )
    } catch (error) {
      await failReply(reply, 'agent_failed')
      throw error
    }
  },
)

previewRoutes.get(`${base}/status`, async (c) => {
  const { organizationId, assistantId } = c.req.param()
  await requirePermission(
    c.req.raw.headers,
    organizationId,
    'assistant',
    'read',
  )
  await ownedAssistant(organizationId, assistantId)
  return c.json(await readingStatus({ organizationId }))
})

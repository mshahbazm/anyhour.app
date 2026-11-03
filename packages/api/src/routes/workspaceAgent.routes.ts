import { limitPublicRequest } from '../services/widget/access'
import { and, asc, desc, eq, getTableColumns, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { workspaceChat, workspaceMessage, member } from '../db/schema'
import { requirePermission, requireSession } from '../services/auth/authorize'
import { ApiError } from '../services/http/apiError'
import { ownerThread } from '../services/teamChat/thread'
import { validateJson } from '../services/http/validateJson'
import { createWorkspaceApiClient } from '../services/workspaceAgent/apiClient'
import {
  beginTurn,
  chatHistory,
  ownedChat,
} from '../services/workspaceAgent/store'
import {
  requireWorkspaceModel,
  workspaceAnswer,
} from '../services/workspaceAgent/answer'
import { actOnRuleDraft } from '../services/workspaceAgent/ruleDraft'
import { ruleDraftActionSchema } from '../schemas/workspaceUi.schema'
import type { tApiDispatch } from '../types/workspaceAgent.types'

export function createWorkspaceAgentRoutes(dispatch: tApiDispatch) {
  const routes = new Hono()
  routes.get('/context', async (c) => {
    const session = await requireSession(c.req.raw.headers)
    const request = createWorkspaceApiClient(c.req.raw.headers, dispatch)
    const organizations = await request<Array<{ id: string; name: string }>>(
      '/api/auth/organization/list',
    )
    const memberships = await db
      .select()
      .from(member)
      .where(eq(member.userId, session.user.id))
    return c.json({
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      },
      organizations: organizations.map((org) => ({
        ...org,
        role: memberships.find((item) => item.organizationId === org.id)?.role,
      })),
      activeOrganizationId: session.session.activeOrganizationId ?? null,
    })
  })
  routes.get('/chats', async (c) => {
    const session = await requireSession(c.req.raw.headers)
    const organizationId = c.req.query('organizationId')
    if (organizationId)
      await requirePermission(
        c.req.raw.headers,
        organizationId,
        'assistant',
        'read',
      )
    const firstMessage = db
      .select({ title: sql<string>`left(${workspaceMessage.content}, 80)` })
      .from(workspaceMessage)
      .where(
        and(
          eq(workspaceMessage.chatId, workspaceChat.id),
          eq(workspaceMessage.role, 'user'),
        ),
      )
      .orderBy(asc(workspaceMessage.createdAt), asc(workspaceMessage.id))
      .limit(1)
    return c.json(
      await db
        .select({
          ...getTableColumns(workspaceChat),
          title: sql<string>`case when ${workspaceChat.title} in ('Knowledge setup', 'New chat') then coalesce((${firstMessage}), 'New chat') else ${workspaceChat.title} end`,
        })
        .from(workspaceChat)
        .where(
          and(
            eq(workspaceChat.userId, session.user.id),
            organizationId
              ? eq(workspaceChat.organizationId, organizationId)
              : isNull(workspaceChat.organizationId),
          ),
        )
        .orderBy(desc(workspaceChat.updatedAt))
        .limit(50),
    )
  })
  // In a workspace: the person's one thread with its AI, shared with their
  // WhatsApp and Slack. Without one: a new chat.
  routes.post(
    '/chats',
    validateJson(
      z.object({ organizationId: z.string().nullable().default(null) }),
    ),
    async (c) => {
      const session = await requireSession(c.req.raw.headers)
      const { organizationId } = c.req.valid('json')
      if (organizationId) {
        await requirePermission(
          c.req.raw.headers,
          organizationId,
          'assistant',
          'read',
        )
        const thread = await ownerThread(session.user.id, organizationId)
        if (!thread)
          throw new ApiError(
            404,
            'assistant_missing',
            'Your AI isn’t set up yet',
          )
        return c.json(thread)
      }
      const [chat] = await db
        .insert(workspaceChat)
        .values({ userId: session.user.id, organizationId: null })
        .returning()
      return c.json(chat, 201)
    },
  )
  routes.get('/chats/:chatId', async (c) => {
    const chat = await ownedChat(c.req.raw.headers, c.req.param('chatId'))
    return c.json({ chat, ...(await chatHistory(chat.id)) })
  })
  routes.post(
    '/chats/:chatId/messages',
    validateJson(
      z.object({
        content: z.string().trim().min(1).max(8000),
        clientMessageId: z.string().min(8).max(128),
      }),
    ),
    async (c) => {
      const chat = await ownedChat(c.req.raw.headers, c.req.param('chatId'))
      await limitPublicRequest(
        {
          assistantId: `workspace-helper:${chat.userId}`,
          nonce: chat.userId,
          origin: 'workspace',
          expiresAt: 0,
        },
        'message',
        20,
      )
      requireWorkspaceModel()
      const reply = await beginTurn(chat.id, c.req.valid('json'))
      return new Response(
        workspaceAnswer(c.req.raw.headers, dispatch, chat.id, reply.id),
        {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            'x-accel-buffering': 'no',
          },
        },
      )
    },
  )
  routes.post(
    '/chats/:chatId/blocks/:blockId/respond',
    validateJson(
      z.object({
        value: z.string().min(1).max(120),
        clientMessageId: z.string().min(8).max(128),
      }),
    ),
    async (c) => {
      const chat = await ownedChat(c.req.raw.headers, c.req.param('chatId'))
      await limitPublicRequest(
        {
          assistantId: `workspace-helper:${chat.userId}`,
          nonce: chat.userId,
          origin: 'workspace',
          expiresAt: 0,
        },
        'message',
        20,
      )
      requireWorkspaceModel()
      const input = c.req.valid('json')
      const reply = await beginTurn(chat.id, {
        content: '',
        clientMessageId: input.clientMessageId,
        blockResponse: { blockId: c.req.param('blockId'), value: input.value },
      })
      return new Response(
        workspaceAnswer(c.req.raw.headers, dispatch, chat.id, reply.id),
        {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            'x-accel-buffering': 'no',
          },
        },
      )
    },
  )
  // Save or dismiss rules drafted in the chat (docs/yourAi.md, "Rules").
  routes.post(
    '/chats/:chatId/blocks/:blockId/rule-draft',
    validateJson(ruleDraftActionSchema),
    async (c) =>
      c.json(
        await actOnRuleDraft(
          c.req.raw.headers,
          c.req.param('chatId'),
          c.req.param('blockId'),
          c.req.valid('json'),
        ),
      ),
  )
  return routes
}

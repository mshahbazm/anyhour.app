import { buildManagementTools } from './managementTools'
import { buildContactTools } from './contactTools'
import { buildMemberRuleTools } from './memberRuleTools'
import { buildSupportTools } from './supportTools'
import { buildKnowledgeTools, createFactSaving } from './knowledgeTools'
import { requireSession } from '../auth/authorize'
import { RunContext, tool } from '@openai/agents'
import { and, eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db'
import {
  workspaceAction,
  workspaceChat,
  workspaceUiBlock,
} from '../../db/schema'
import { ApiError } from '../http/apiError'
import { createWorkspaceApiClient } from './apiClient'
import { ownedChat } from './store'
import { getSkill, skillNames } from './skills/loader'
import { holdForConfirmation } from './confirmations'
import { buildChannelTools } from './channelTools'
import {
  confirmFirstTools,
  type tTeamChatApp,
} from '../../config/teamChat.config'
import type { iPendingAction } from '../../db/schema/product/workspaceUiBlock'
import type {
  tApiDispatch,
  tWorkspaceEvent,
} from '../../types/workspaceAgent.types'

export interface iWorkspaceToolContext {
  headers: Headers
  dispatch: tApiDispatch
  chatId: string
  messageId: string
  signal: AbortSignal
  emit: (event: tWorkspaceEvent) => void
  /** Set when the member writes from a chat app (docs/teamChat.md). */
  app?: tTeamChatApp
  /** The held action the member just confirmed; it may run now. */
  confirmed?: iPendingAction
}

const sameInput = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  JSON.stringify(a, Object.keys(a).sort()) ===
  JSON.stringify(b, Object.keys(b).sort())

function createToolRuntime(ctx: iWorkspaceToolContext) {
  const request = createWorkspaceApiClient(
    ctx.headers,
    ctx.dispatch,
    ctx.signal,
  )
  let toolQueue: Promise<unknown> = Promise.resolve()
  async function scope() {
    ctx.signal.throwIfAborted()
    const chat = await ownedChat(ctx.headers, ctx.chatId)
    if (!chat.organizationId)
      throw new ApiError(409, 'workspace_required', 'Create a workspace first')
    const base = `/api/organizations/${encodeURIComponent(chat.organizationId)}/assistants`
    return { chat, base }
  }
  async function assistantBase() {
    const { chat, base } = await scope()
    if (!chat.assistantId)
      throw new ApiError(409, 'assistant_required', 'Your AI isn’t set up yet')
    return `${base}/${encodeURIComponent(chat.assistantId)}`
  }
  // Your business: the workspace's shared sources.
  async function businessBase() {
    const { chat } = await scope()
    return `/api/organizations/${encodeURIComponent(chat.organizationId!)}/business`
  }
  const { saveNote, saveConfirmed } = createFactSaving({
    ctx,
    request,
    assistantBase,
    businessBase,
  })
  async function changed() {
    const chat = await ownedChat(ctx.headers, ctx.chatId)
    ctx.emit({
      type: 'context',
      organizationId: chat.organizationId,
      assistantId: chat.assistantId,
    })
  }
  function execute<T extends Record<string, unknown>>(
    name: string,
    fn: (input: T) => Promise<unknown>,
    mutation = false,
  ) {
    return (input: T) => {
      const queued = toolQueue.then(async () => {
        ctx.signal.throwIfAborted()
        await ownedChat(ctx.headers, ctx.chatId)
        if (
          ctx.app &&
          Object.hasOwn(confirmFirstTools, name) &&
          !(
            ctx.confirmed?.name === name &&
            sameInput(ctx.confirmed.input, input)
          )
        )
          return holdForConfirmation(ctx, name, input)
        // Suppress repeated calls within a turn. Unknown writes must be reconciled, never replayed.
        if (mutation) {
          const prior = await db
            .select()
            .from(workspaceAction)
            .where(eq(workspaceAction.messageId, ctx.messageId))
          const match = prior.find(
            (row) => row.name === name && sameInput(row.input, input),
          )
          if (match?.status === 'completed') return match.result
          if (match && match.status !== 'failed')
            return {
              error: 'outcome_unknown',
              message: 'Inspect current state before trying another write.',
            }
        }
        const [action] = await db
          .insert(workspaceAction)
          .values({ messageId: ctx.messageId, name, input })
          .returning()
        ctx.emit({ type: 'activity', id: action.id, name, status: 'running' })
        try {
          const result = await fn(input)
          await db
            .update(workspaceAction)
            .set({ result, status: 'completed', completedAt: new Date() })
            .where(eq(workspaceAction.id, action.id))
          ctx.emit({
            type: 'activity',
            id: action.id,
            name,
            status: 'completed',
          })
          if (mutation) await changed().catch(() => undefined)
          return result
        } catch (error) {
          const status =
            mutation && (!(error instanceof ApiError) || error.status >= 500)
              ? 'unknown'
              : 'failed'
          const result = {
            ...(error instanceof ApiError && error.status < 500
              ? error.details
              : {}),
            error: error instanceof ApiError ? error.code : 'action_failed',
            message:
              error instanceof ApiError
                ? error.message
                : 'Action interrupted. Check current state before retrying.',
          }
          await db
            .update(workspaceAction)
            .set({ status, result, completedAt: new Date() })
            .where(eq(workspaceAction.id, action.id))
          ctx.emit({ type: 'activity', id: action.id, name, status })
          return result
        }
      })
      toolQueue = queued.catch(() => undefined)
      return queued
    }
  }
  return {
    request,
    scope,
    assistantBase,
    businessBase,
    changed,
    execute,
    saveNote,
    saveConfirmed,
  }
}

export function buildWorkspaceTools(ctx: iWorkspaceToolContext) {
  const {
    request,
    assistantBase,
    businessBase,
    execute,
    saveNote,
    saveConfirmed,
  } = createToolRuntime(ctx)
  const sourceParams = z.object({ sourceId: z.string().min(1) })
  return [
    ...buildManagementTools(ctx, execute),
    ...buildContactTools(ctx, execute),
    ...buildMemberRuleTools(ctx, execute),
    ...buildSupportTools(ctx, execute),
    ...buildChannelTools(ctx, execute),
    tool({
      name: 'read_skill',
      description:
        'Load the step-by-step instructions for a skill listed in <available_skills>. Call it before a non-trivial task and follow the returned procedure.',
      parameters: z.object({ name: z.enum(skillNames) }),
      execute: async ({ name }) => {
        return (
          getSkill(name)?.body ??
          `No skill named "${name}". Available: ${skillNames.join(', ')}`
        )
      },
    }),
    tool({
      name: 'get_context',
      description:
        'Read the account, its workspaces and you (the workspace’s AI). Use before setup.',
      parameters: z.object({}),
      execute: execute('get_context', async () => {
        const chat = await ownedChat(ctx.headers, ctx.chatId)
        const organizations = await request('/api/auth/organization/list')
        const ai = chat.organizationId
          ? await request<Record<string, unknown>>(
              `/api/organizations/${encodeURIComponent(chat.organizationId)}/assistant`,
            ).catch(() => null)
          : null
        const { user } = await requireSession(ctx.headers)
        const workspace = chat.organizationId
          ? await request(`/api/organizations/${chat.organizationId}/workspace`)
          : null
        return {
          user: {
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
          },
          workspace,
          organizations,
          you: ai,
          organizationId: chat.organizationId,
        }
      }),
    }),
    tool({
      name: 'create_workspace',
      description:
        'Create the workspace requested by a user who has no workspace selected, and bind this chat to it.',
      parameters: z.object({ name: z.string().trim().min(1).max(120) }),
      execute: execute(
        'create_workspace',
        async ({ name }) => {
          const chat = await ownedChat(ctx.headers, ctx.chatId)
          if (chat.organizationId)
            throw new ApiError(
              409,
              'workspace_exists',
              'This chat already belongs to a workspace',
            )
          const organizations = await request<Array<{ id: string }>>(
            '/api/auth/organization/list',
          )
          if (organizations.length)
            throw new ApiError(
              409,
              'select_workspace',
              'Use the workspace selector to select your existing workspace',
            )
          const organization = await request<{ id: string; name: string }>(
            '/api/auth/organization/create',
            'POST',
            { name, slug: `workspace-${chat.id}` },
          )
          await db
            .update(workspaceChat)
            .set({ organizationId: organization.id })
            .where(eq(workspaceChat.id, chat.id))
          return { id: organization.id, name: organization.name }
        },
        true,
      ),
    }),
    tool({
      name: 'list_sources',
      description:
        'List the websites, pages and files in Your business with their reading state. Pass a cursor to read more pages.',
      parameters: z.object({ cursor: z.string().nullable() }),
      execute: execute('list_sources', async ({ cursor }) => {
        let nextCursor: string | null = null
        const base = await businessBase()
        const sources = await request(
          `${base}/sources?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          'GET',
          undefined,
          (response) => {
            nextCursor = response.headers.get('X-Next-Cursor')
          },
        )
        return { sources, nextCursor }
      }),
    }),
    tool({
      name: 'add_source',
      description:
        'Read a user-supplied website, individual page, or public document URL into Your business.',
      parameters: z.object({
        kind: z.enum(['website', 'webPage', 'publicDocument']),
        url: z.string(),
      }),
      execute: execute(
        'add_source',
        async (input) =>
          request(`${await businessBase()}/sources`, 'POST', input),
        true,
      ),
    }),
    ...buildKnowledgeTools({
      execute,
      request,
      assistantBase,
      businessBase,
      saveNote,
      saveConfirmed,
    }),
    tool({
      name: 'inspect_source',
      description:
        'Read a knowledge source and highlight it in the right panel.',
      parameters: sourceParams,
      execute: execute('inspect_source', async ({ sourceId }) => {
        const source = await request<Record<string, unknown>>(
          `${await businessBase()}/sources/${encodeURIComponent(sourceId)}`,
        )
        ctx.emit({ type: 'source', sourceId })
        return {
          id: source.id,
          title: source.title,
          url: source.inputUrl,
          status: source.status,
          lastError: source.lastError,
          archiveNotice: source.archiveNotice,
          cleanedText:
            typeof source.cleanedText === 'string'
              ? source.cleanedText.slice(0, 16000)
              : null,
        }
      }),
    }),
    tool({
      name: 'refresh_source',
      description: 'Queue re-indexing of a source at the user’s request.',
      parameters: sourceParams,
      execute: execute(
        'refresh_source',
        async ({ sourceId }) =>
          request(
            `${await businessBase()}/sources/${encodeURIComponent(sourceId)}/runs`,
            'POST',
            {},
          ),
        true,
      ),
    }),
    tool({
      name: 'set_source_included',
      description: 'Switch a source on or off at the user’s request.',
      parameters: z.object({
        sourceId: z.string().min(1),
        isIncluded: z.boolean(),
      }),
      execute: execute(
        'set_source_included',
        async ({ sourceId, isIncluded }) =>
          request(
            `${await businessBase()}/sources/${encodeURIComponent(sourceId)}`,
            'PATCH',
            { isIncluded },
          ),
        true,
      ),
    }),
    tool({
      name: 'indexing_status',
      description:
        'Get recent ingestion runs. Do not continuously poll this tool.',
      parameters: z.object({}),
      execute: execute('indexing_status', async () =>
        request(`${await businessBase()}/runs`),
      ),
    }),
  ]
}

// A tap on "Use my new answer" saves before the helper replies, so the save
// never depends on the model remembering it; the helper only reports it.
export async function applyTappedConfirmation(ctx: iWorkspaceToolContext) {
  const [block] = await db
    .select({ id: workspaceUiBlock.id })
    .from(workspaceUiBlock)
    .where(
      and(
        eq(workspaceUiBlock.chatId, ctx.chatId),
        eq(workspaceUiBlock.responseReplyId, ctx.messageId),
        eq(workspaceUiBlock.status, 'resolved'),
        eq(workspaceUiBlock.resolvedValue, 'confirm'),
        isNotNull(workspaceUiBlock.pendingNote),
      ),
    )
    .limit(1)
  if (!block) return null
  const { execute, saveConfirmed } = createToolRuntime(ctx)
  const result = await execute(
    'save_confirmed_fact',
    async ({ confirmationId }: { confirmationId: string }) =>
      saveConfirmed(confirmationId),
    true,
  )({ confirmationId: block.id })
  return { name: 'save_confirmed_fact', result }
}

// A held action the member confirmed (a button, or an exact "yes") runs
// before the model replies, from exactly the input it was shown with, with
// the member's permissions like any other call.
export async function applyConfirmedAction(ctx: iWorkspaceToolContext) {
  const [block] = await db
    .select({ pendingAction: workspaceUiBlock.pendingAction })
    .from(workspaceUiBlock)
    .where(
      and(
        eq(workspaceUiBlock.chatId, ctx.chatId),
        eq(workspaceUiBlock.responseReplyId, ctx.messageId),
        eq(workspaceUiBlock.status, 'resolved'),
        eq(workspaceUiBlock.resolvedValue, 'confirm'),
        isNotNull(workspaceUiBlock.pendingAction),
      ),
    )
    .limit(1)
  const action = block?.pendingAction
  if (!action) return null
  const held = buildWorkspaceTools({ ...ctx, confirmed: action }).find(
    (item) => item.name === action.name,
  )
  if (!held || held.type !== 'function') return null
  await held.invoke(new RunContext(), JSON.stringify(action.input))
  const [done] = await db
    .select({ result: workspaceAction.result })
    .from(workspaceAction)
    .where(
      and(
        eq(workspaceAction.messageId, ctx.messageId),
        eq(workspaceAction.name, action.name),
      ),
    )
    .limit(1)
  return { name: action.name, result: done?.result ?? null }
}

import { jobLength } from '../../config/onboarding.config'
import { tool } from '@openai/agents'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db'
import { member, invitation, user, workspaceUiBlock } from '../../db/schema'
import { leadStatuses } from '../../db/schema/product/lead'
import { requirePermission, requireSession } from '../auth/authorize'
import { ApiError } from '../http/apiError'
import { createWorkspaceApiClient } from './apiClient'
import { ownedChat } from './store'
import { createUiBlock } from './uiBlocks'
import { botPictureStyleIds } from '../../config/botPicture.config'
import { workspaceUiSchema } from '../../schemas/workspaceUi.schema'
import type { iWorkspaceToolContext } from './tools'

export type tExecute = <T extends Record<string, unknown>>(
  name: string,
  fn: (input: T) => Promise<unknown>,
  mutation?: boolean,
) => (input: T) => Promise<unknown>

export function buildManagementTools(
  ctx: iWorkspaceToolContext,
  execute: tExecute,
) {
  const request = createWorkspaceApiClient(
    ctx.headers,
    ctx.dispatch,
    ctx.signal,
  )
  async function scope() {
    const chat = await ownedChat(ctx.headers, ctx.chatId)
    if (!chat.organizationId)
      throw new ApiError(409, 'workspace_required', 'Create a workspace first')
    return { ...chat, organizationId: chat.organizationId }
  }
  async function targetMember(id: string) {
    const chat = await scope()
    const [record] = await db
      .select({
        id: member.id,
        role: member.role,
        name: user.name,
        email: user.email,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(
        and(eq(member.id, id), eq(member.organizationId, chat.organizationId)),
      )
    if (!record)
      throw new ApiError(
        404,
        'member_missing',
        'Member not found in this workspace',
      )
    if (record.role === 'owner')
      throw new ApiError(
        403,
        'owner_protected',
        'Owner changes are not supported by the helper',
      )
    return { chat, record }
  }
  const role = z.enum(['admin', 'member'])
  return [
    tool({
      name: 'show_choices',
      description:
        'Display a choice, action buttons, summary/list, or confirmation in chat. Use only when useful. End the turn after interactive blocks. This tool cannot authorize member removal.',
      parameters: workspaceUiSchema,
      execute: execute('show_choices', (input) => createUiBlock(ctx, input)),
    }),
    tool({
      name: 'get_profile',
      description:
        'Read the signed-in name and verified email; never ask again for existing account information.',
      parameters: z.object({}),
      execute: execute('get_profile', async () => {
        const { user } = await requireSession(ctx.headers)
        return {
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
        }
      }),
    }),
    tool({
      name: 'update_profile_name',
      description:
        'Save the user’s supplied name if missing or explicitly corrected. Never change email.',
      parameters: z.object({ name: z.string().trim().min(1).max(120) }),
      execute: execute(
        'update_profile_name',
        (input) => request('/api/auth/update-user', 'POST', input),
        true,
      ),
    }),
    tool({
      name: 'get_workspace',
      description:
        'Read this workspace’s name and the owner’s description of the business.',
      parameters: z.object({}),
      execute: execute('get_workspace', async () =>
        request(
          `/api/organizations/${(await scope()).organizationId}/workspace`,
        ),
      ),
    }),
    tool({
      name: 'list_connections',
      description:
        'Which chat apps are connected and whether they work: the user’s WhatsApp agents (and, for owners and admins, the team’s), Slack, and the business’s WhatsApp number for customers (whatsapp_business). Read only; connecting happens on the Channels page.',
      parameters: z.object({}),
      execute: execute('list_connections', async () => {
        const base = `/api/organizations/${(await scope()).organizationId}`
        const [whatsapp, apps] = await Promise.all([
          request(`${base}/whatsapp`),
          request(`${base}/connections`),
        ])
        return { whatsapp, apps }
      }),
    }),
    tool({
      name: 'update_workspace',
      description:
        'Change the workspace (business) name. Websites are not a workspace setting: they are knowledge sources (add-knowledge) or places the chat may appear (Install).',
      parameters: z.object({
        name: z.string().trim().min(1).max(120),
      }),
      execute: execute(
        'update_workspace',
        async ({ name }) => {
          const chat = await scope()
          return request(
            `/api/organizations/${chat.organizationId}/workspace`,
            'PATCH',
            { name },
          )
        },
        true,
      ),
    }),
    tool({
      name: 'set_ideal_customer_profile',
      description:
        'Save the ideal customer profile: the owner’s plain description of the customers they want. New leads are scored against it. Null clears it.',
      parameters: z.object({
        text: z.string().trim().min(1).max(2000).nullable(),
      }),
      execute: execute(
        'set_ideal_customer_profile',
        async ({ text }) => {
          const chat = await scope()
          const saved = await request<{ idealCustomerProfile: string | null }>(
            `/api/organizations/${chat.organizationId}/workspace`,
            'PATCH',
            { idealCustomerProfile: text },
          )
          return { idealCustomerProfile: saved.idealCustomerProfile }
        },
        true,
      ),
    }),
    tool({
      name: 'set_bot_goal',
      description:
        'Save how you should treat visitors, as short notes in the owner’s words. You always answer and catch enquiries: use goal both unless the owner explicitly asks otherwise.',
      parameters: z.object({
        goal: z.enum(['answers', 'enquiries', 'both']),
        notes: z.string().max(2000).nullable(),
      }),
      execute: execute(
        'set_bot_goal',
        async (input) => {
          const chat = await scope()
          if (!chat.assistantId)
            throw new ApiError(409, 'assistant_required', 'Select a bot first')
          return request(
            `/api/organizations/${chat.organizationId}/assistants/${chat.assistantId}`,
            'PATCH',
            { goal: input.goal, goalNotes: input.notes },
          )
        },
        true,
      ),
    }),
    tool({
      name: 'rename_bot',
      description: 'Rename this bot (you) at the user’s request.',
      parameters: z.object({ name: z.string().trim().min(1).max(120) }),
      execute: execute(
        'rename_bot',
        async ({ name }) => {
          const chat = await scope()
          if (!chat.assistantId)
            throw new ApiError(409, 'assistant_required', 'Select a bot first')
          const bot = await request<{ name: string }>(
            `/api/organizations/${chat.organizationId}/assistants/${chat.assistantId}`,
            'PATCH',
            { name },
          )
          return { name: bot.name }
        },
        true,
      ),
    }),
    tool({
      name: 'set_job',
      description:
        'Rewrite your job, one plain sentence of what you do (for example "Answers your customers on WhatsApp and books them in"), when the owner changes what you’re for. Null clears it.',
      parameters: z.object({
        job: z.string().trim().min(1).max(jobLength).nullable(),
      }),
      execute: execute(
        'set_job',
        async ({ job }) => {
          const chat = await scope()
          if (!chat.assistantId)
            throw new ApiError(409, 'assistant_required', 'Select a bot first')
          const bot = await request<{ job: string | null }>(
            `/api/organizations/${chat.organizationId}/assistants/${chat.assistantId}`,
            'PATCH',
            { job },
          )
          return { job: bot.job }
        },
        true,
      ),
    }),
    tool({
      name: 'create_bot_picture',
      description:
        'Generate a new photorealistic profile picture for this bot (you), replacing the current one. Takes up to a minute. Style is optional; description is the user’s own words about the person.',
      parameters: z.object({
        style: z.enum(botPictureStyleIds).nullable(),
        description: z.string().trim().max(400).nullable(),
      }),
      execute: execute(
        'create_bot_picture',
        async (input) => {
          const chat = await scope()
          if (!chat.assistantId)
            throw new ApiError(409, 'assistant_required', 'Select a bot first')
          await request(
            `/api/organizations/${chat.organizationId}/assistants/${chat.assistantId}/picture`,
            'POST',
            input,
          )
          return { message: 'New picture saved. The app shows it now.' }
        },
        true,
      ),
    }),
    tool({
      name: 'list_leads',
      description: 'Read the most recent leads with lead IDs (read-only).',
      parameters: z.object({}),
      execute: execute('list_leads', async () => {
        const chat = await scope()
        const leads = await request<
          Array<{
            id: string
            title: string
            summary: string | null
            status: string
            value: number | null
            capturedVia: string
            reason: string
            createdAt: string
            contactName: string | null
            contactEmail: string | null
            contactPhone: string | null
          }>
        >(`/api/organizations/${chat.organizationId}/leads?limit=25`)
        return leads.map((lead) => ({
          leadId: lead.id,
          title: lead.title,
          summary: lead.summary?.slice(0, 400) ?? null,
          status: lead.status,
          value: lead.value === null ? null : lead.value / 100,
          capturedVia: lead.capturedVia,
          reason:
            lead.reason === 'question'
              ? 'unanswered question — needs a reply'
              : 'enquiry',
          createdAt: lead.createdAt,
          name: lead.contactName,
          email: lead.contactEmail,
          phone: lead.contactPhone,
        }))
      }),
    }),
    tool({
      name: 'set_lead_status',
      description:
        'Mark a lead new, contacted, won or lost; for won, optionally with what it is worth (a plain amount, e.g. 1250.50).',
      parameters: z.object({
        leadId: z.string().min(1),
        status: z.enum(leadStatuses),
        value: z.number().min(0).nullable(),
      }),
      execute: execute(
        'set_lead_status',
        async ({ leadId, status, value }) => {
          const chat = await scope()
          const saved = await request<{
            id: string
            title: string
            status: string
            value: number | null
          }>(
            `/api/organizations/${chat.organizationId}/leads/${encodeURIComponent(leadId)}`,
            'PATCH',
            {
              status,
              ...(status === 'won' && value !== null
                ? { value: Math.round(value * 100) }
                : {}),
            },
          )
          return {
            leadId: saved.id,
            title: saved.title,
            status: saved.status,
            value: saved.value === null ? null : saved.value / 100,
          }
        },
        true,
      ),
    }),
    tool({
      name: 'list_visitor_conversations',
      description:
        'Read the most recent conversations this bot had with website visitors: first question, size and time (read-only).',
      parameters: z.object({}),
      execute: execute('list_visitor_conversations', async () => {
        const chat = await scope()
        if (!chat.assistantId)
          throw new ApiError(409, 'assistant_required', 'Select a bot first')
        const conversations = await request<
          Array<{
            preview: string | null
            messageCount: number
            status: string
            createdAt: string
            lastMessageAt: string | null
            contactName: string | null
          }>
        >(
          `/api/organizations/${chat.organizationId}/assistants/${chat.assistantId}/conversations?limit=25`,
        )
        return conversations.map((item) => ({
          firstQuestion: item.preview,
          messages: item.messageCount,
          status: item.status,
          visitor: item.contactName,
          startedAt: item.createdAt,
          lastMessageAt: item.lastMessageAt,
        }))
      }),
    }),
    tool({
      name: 'list_team',
      description:
        'Read actual workspace members, pending invitations, and roles available to this caller. Use real IDs from this result for team operations. Supports member pagination.',
      parameters: z.object({ offset: z.number().int().min(0) }),
      execute: execute('list_team', async ({ offset }) => {
        const chat = await scope()
        const { membership } = await requirePermission(
          ctx.headers,
          chat.organizationId,
          'assistant',
          'read',
        )
        const members = await request(
          `/api/auth/organization/list-members?organizationId=${encodeURIComponent(chat.organizationId)}&limit=50&offset=${offset}`,
        )
        const canManage =
          membership.role === 'owner' || membership.role === 'admin'
        const invitations = canManage
          ? await request(
              `/api/auth/organization/list-invitations?organizationId=${encodeURIComponent(chat.organizationId)}`,
            )
          : []
        return {
          members,
          invitations,
          nextOffset: offset + 50,
          availableRoles: canManage
            ? [
                {
                  value: 'member',
                  label: 'Member',
                  description:
                    'Read bots and manage leads; cannot change workspace or knowledge.',
                },
                {
                  value: 'admin',
                  label: 'Admin',
                  description:
                    'Manage workspace, bots, knowledge and team; cannot change ownership.',
                },
              ]
            : [],
        }
      }),
    }),
    tool({
      name: 'invite_member',
      description:
        'Send a workspace invitation when the user supplied an email and role. If role is missing, show permissible roles first. Do not resend existing pending invitations automatically.',
      parameters: z.object({ email: z.email(), role }),
      execute: execute(
        'invite_member',
        async (input) => {
          const chat = await scope()
          await requirePermission(
            ctx.headers,
            chat.organizationId,
            'invitation',
            'create',
          )
          return request('/api/auth/organization/invite-member', 'POST', {
            ...input,
            organizationId: chat.organizationId,
          })
        },
        true,
      ),
    }),
    tool({
      name: 'update_member_role',
      description:
        'Change an existing non-owner member’s role when explicitly requested. Resolve ambiguous names using list_team first.',
      parameters: z.object({ memberId: z.string().min(1), role }),
      execute: execute(
        'update_member_role',
        async (input) => {
          const { chat } = await targetMember(input.memberId)
          await requirePermission(
            ctx.headers,
            chat.organizationId,
            'member',
            'update',
          )
          return request('/api/auth/organization/update-member-role', 'POST', {
            ...input,
            organizationId: chat.organizationId,
          })
        },
        true,
      ),
    }),
    tool({
      name: 'cancel_invitation',
      description:
        'Cancel the user-requested pending invitation from list_team in this workspace.',
      parameters: z.object({ invitationId: z.string().min(1) }),
      execute: execute(
        'cancel_invitation',
        async ({ invitationId }) => {
          const chat = await scope()
          await requirePermission(
            ctx.headers,
            chat.organizationId,
            'invitation',
            'cancel',
          )
          const [record] = await db
            .select()
            .from(invitation)
            .where(
              and(
                eq(invitation.id, invitationId),
                eq(invitation.organizationId, chat.organizationId),
              ),
            )
          if (!record)
            throw new ApiError(
              404,
              'invitation_missing',
              'Invitation not found',
            )
          return request('/api/auth/organization/cancel-invitation', 'POST', {
            invitationId,
          })
        },
        true,
      ),
    }),
    tool({
      name: 'request_member_removal',
      description:
        'Show a server-bound confirmation for a user-requested member removal. End the turn and wait.',
      parameters: z.object({ memberId: z.string().min(1) }),
      execute: execute('request_member_removal', async ({ memberId }) => {
        const { chat, record } = await targetMember(memberId)
        await requirePermission(
          ctx.headers,
          chat.organizationId,
          'member',
          'delete',
        )
        return createUiBlock(
          ctx,
          {
            type: 'confirmation',
            title: `Remove ${record.name || record.email} from this workspace?`,
            description: `${record.email} will lose ${record.role} access.`,
            options: [
              { value: 'confirm', label: 'Remove member', description: null },
              { value: 'cancel', label: 'Keep member', description: null },
            ],
            items: [],
          },
          { memberId, role: record.role },
        )
      }),
    }),
    tool({
      name: 'remove_member',
      description:
        'Execute the member removal approved in the current turn. Requires the exact confirmation block ID from saved UI choices. Never available for owners.',
      parameters: z.object({ blockId: z.string().min(1) }),
      execute: execute(
        'remove_member',
        async ({ blockId }) => {
          const [block] = await db
            .select()
            .from(workspaceUiBlock)
            .where(
              and(
                eq(workspaceUiBlock.id, blockId),
                eq(workspaceUiBlock.chatId, ctx.chatId),
                eq(workspaceUiBlock.responseReplyId, ctx.messageId),
                eq(workspaceUiBlock.status, 'resolved'),
                eq(workspaceUiBlock.resolvedValue, 'confirm'),
              ),
            )
          if (!block?.removalMemberId)
            throw new ApiError(
              409,
              'confirmation_required',
              'Ask the user to confirm this member removal first',
            )
          const { chat, record } = await targetMember(block.removalMemberId)
          await requirePermission(
            ctx.headers,
            chat.organizationId,
            'member',
            'delete',
          )
          if (record.role !== block.removalRole)
            throw new ApiError(
              409,
              'member_changed',
              'This member’s role changed; request a new confirmation',
            )
          const claimed = await db
            .update(workspaceUiBlock)
            .set({ status: 'consumed' })
            .where(
              and(
                eq(workspaceUiBlock.id, blockId),
                eq(workspaceUiBlock.status, 'resolved'),
              ),
            )
            .returning()
          if (!claimed.length)
            throw new ApiError(
              409,
              'confirmation_used',
              'This confirmation has already been used',
            )
          return request('/api/auth/organization/remove-member', 'POST', {
            memberIdOrEmail: record.id,
            organizationId: chat.organizationId,
          })
        },
        true,
      ),
    }),
  ]
}

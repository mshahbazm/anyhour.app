import { tool } from '@openai/agents'
import { z } from 'zod'
import type {
  iAttention,
  iInboxConversation,
  iInboxMessage,
} from '../../types/support.types'
import { ApiError } from '../http/apiError'
import { holdForConfirmation } from './confirmations'
import { createWorkspaceApiClient } from './apiClient'
import type { tExecute } from './managementTools'
import { ownedChat } from './store'
import type { iWorkspaceToolContext } from './tools'

// The inbox from the owner chat. Every call goes through the
// HTTP API as the signed-in user, so a reply goes out under their name and
// each route re-checks the workspace and their permission.

export function buildSupportTools(
  ctx: iWorkspaceToolContext,
  execute: tExecute,
) {
  const request = createWorkspaceApiClient(
    ctx.headers,
    ctx.dispatch,
    ctx.signal,
  )
  async function workspaceBase() {
    const chat = await ownedChat(ctx.headers, ctx.chatId)
    if (!chat.organizationId)
      throw new ApiError(409, 'workspace_required', 'Create a workspace first')
    return `/api/organizations/${encodeURIComponent(chat.organizationId)}`
  }
  const conversationPath = async (id: string) =>
    `${await workspaceBase()}/conversations/${encodeURIComponent(id)}`
  const said = (item: iInboxMessage) => ({
    from:
      item.role === 'visitor'
        ? 'visitor'
        : item.role === 'staff'
          ? (item.staff?.name ?? 'the team')
          : 'you',
    text: item.content.slice(0, 1500),
    at: item.createdAt,
  })
  return [
    tool({
      name: 'list_needs_you',
      description:
        'Read what needs the team now: visitor conversations waiting for a person.',
      parameters: z.object({}),
      execute: execute('list_needs_you', async () => {
        const { support } = await request<iAttention>(
          `${await workspaceBase()}/attention`,
        )
        return {
          conversations: support.conversations.map((item) => ({
            conversationId: item.id,
            visitor: item.contactName ?? 'Visitor',
            wants: item.wants,
            lastMessage: item.lastVisitorMessage,
            waitingSince: item.needsHumanSince,
            withTheTeam: item.handledBy === 'human',
          })),
        }
      }),
    }),
    tool({
      name: 'read_conversation',
      description:
        'Read one visitor conversation from the inbox: who it is, the messages, the handoff summary and my suggested reply (read-only). Use a conversationId from list_needs_you.',
      parameters: z.object({ conversationId: z.string().min(1) }),
      execute: execute('read_conversation', async ({ conversationId }) => {
        const detail = await request<iInboxConversation>(
          await conversationPath(conversationId),
        )
        const chat = detail.conversation
        return {
          id: chat.id,
          visitor: chat.contact?.name ?? chat.contact?.email ?? 'Visitor',
          contactId: chat.contact?.id ?? null,
          aiTeamMember: chat.assistantName,
          handledBy: chat.handledBy === 'human' ? 'the team' : 'you',
          waitingSince: chat.needsHumanSince,
          handoff: chat.handoffSummary,
          suggestedReply: chat.handoffDraft,
          messages: detail.messages.slice(-30).map(said),
        }
      }),
    }),
    tool({
      name: 'reply_to_conversation',
      description:
        'Send the user’s reply to a visitor in their website chat, as a staff message under the user’s name. You then stay quiet in that conversation until release_conversation. Send only words the user gave or approved.',
      parameters: z.object({
        conversationId: z.string().min(1),
        text: z.string().trim().min(1).max(4000),
      }),
      execute: execute(
        'reply_to_conversation',
        async ({ conversationId, text }) => {
          const sent = await request<iInboxMessage>(
            `${await conversationPath(conversationId)}/messages`,
            'POST',
            { content: text, noteOfferIn: 'chat' },
          )
          const done = { sent: true, messageId: sent.id, as: sent.staff?.name }
          if (!sent.noteOffer) return done
          // The answer looks worth remembering: offer it here, where they
          // replied. Save runs the normal note save; anything else drops it.
          await holdForConfirmation(
            ctx,
            'add_knowledge_note',
            {
              title: sent.noteOffer.title,
              text: sent.noteOffer.text,
              fromMessageId: sent.id,
            },
            {
              title: 'Save this so I can answer it next time?',
              description: sent.noteOffer.text,
              labels: { confirm: 'Save', cancel: 'Not now' },
            },
          )
          return {
            ...done,
            offeredToRemember: sent.noteOffer.text,
            next: 'A card now asks the user whether to save this answer as a note. Say in one short line that the reply was sent; don’t repeat the card.',
          }
        },
        true,
      ),
    }),
    tool({
      name: 'release_conversation',
      description:
        'Take back a conversation the team took over: you answer the visitor again and the conversation leaves Needs you.',
      parameters: z.object({ conversationId: z.string().min(1) }),
      execute: execute(
        'release_conversation',
        async ({ conversationId }) => {
          await request(
            `${await conversationPath(conversationId)}/release`,
            'POST',
          )
          return { released: conversationId }
        },
        true,
      ),
    }),
  ]
}

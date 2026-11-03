import { channelNames } from '../../config/channels.config'
import { tool } from '@openai/agents'
import { z } from 'zod'
import type { iConnectionList } from '../../types/connection.types'
import { ApiError } from '../http/apiError'
import { createWorkspaceApiClient } from './apiClient'
import type { tExecute } from './managementTools'
import { ownedChat } from './store'
import type { iWorkspaceToolContext } from './tools'

// Channels: where customers reach the AI (website chats, WhatsApp) and where
// the team talks to it (Slack). They are set up on the Channels page.

export function buildChannelTools(
  ctx: iWorkspaceToolContext,
  execute: tExecute,
) {
  const request = createWorkspaceApiClient(
    ctx.headers,
    ctx.dispatch,
    ctx.signal,
  )
  return [
    tool({
      name: 'list_channels',
      description:
        'The business’s channels: website chats (one per site) and WhatsApp where customers reach you, and Slack where the team talks to you. Read only; channels are set up on the Channels page.',
      parameters: z.object({}),
      execute: execute('list_channels', async () => {
        const chat = await ownedChat(ctx.headers, ctx.chatId)
        if (!chat.organizationId)
          throw new ApiError(
            409,
            'workspace_required',
            'Create a workspace first',
          )
        const list = await request<iConnectionList>(
          `/api/organizations/${encodeURIComponent(chat.organizationId)}/connections`,
        )
        const channels = list.connections.map((item) => ({
          connectionId: item.id,
          channel: channelNames[item.provider],
          where:
            item.provider === 'website'
              ? item.externalAccountId
              : (item.phoneNumber ?? item.accountName),
          customers: item.provider !== 'slack',
          working: item.status === 'active',
          chatCodeSeen: item.provider === 'website' ? item.installStatus : null,
        }))
        return {
          channels,
          note: channels.length
            ? null
            : 'No channels yet: they are set up on the Channels page.',
        }
      }),
    }),
  ]
}

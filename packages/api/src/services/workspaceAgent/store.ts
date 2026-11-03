import { publicBlock } from './uiBlocks'
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm'
import { db } from '../../db'
import {
  workspaceAction,
  workspaceChat,
  workspaceMessage,
  workspaceUiBlock,
} from '../../db/schema'
import { requirePermission, requireSession } from '../auth/authorize'
import { ApiError } from '../http/apiError'
import { workspaceAgentConfig } from '../../config/workspaceAgent.config'
import { isChoiceBlock } from '../../schemas/workspaceUi.schema'
import type { tTeamChatApp } from '../../config/teamChat.config'

// The only typed words that confirm a held action: an exact "yes".
const exactYes = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, '') === 'yes'

export async function ownedChat(headers: Headers, id: string) {
  const session = await requireSession(headers)
  const [chat] = await db
    .select()
    .from(workspaceChat)
    .where(
      and(eq(workspaceChat.id, id), eq(workspaceChat.userId, session.user.id)),
    )
  if (!chat) throw new ApiError(404, 'chat_missing', 'Chat not found')
  if (chat.organizationId)
    await requirePermission(headers, chat.organizationId, 'assistant', 'read')
  return chat
}

export async function recoverChat(id: string) {
  // No automatic write replay after a process crash. In-flight tool outcomes are unknown.
  const stale = await db
    .update(workspaceMessage)
    .set({
      status: 'failed',
      errorCode: 'interrupted',
      completedAt: new Date(),
    })
    .where(
      and(
        eq(workspaceMessage.chatId, id),
        eq(workspaceMessage.status, 'running'),
        lt(
          workspaceMessage.createdAt,
          new Date(Date.now() - workspaceAgentConfig.timeoutMs - 30_000),
        ),
      ),
    )
    .returning({ id: workspaceMessage.id })
  if (stale.length)
    await db
      .update(workspaceAction)
      .set({ status: 'unknown' })
      .where(
        and(
          inArray(
            workspaceAction.messageId,
            stale.map((row) => row.id),
          ),
          eq(workspaceAction.status, 'running'),
        ),
      )
}

export async function chatHistory(id: string) {
  await recoverChat(id)
  const recent = await db
    .select()
    .from(workspaceMessage)
    .where(eq(workspaceMessage.chatId, id))
    .orderBy(desc(workspaceMessage.createdAt), desc(workspaceMessage.id))
    .limit(100)
  const messages = recent.reverse()
  const actions = messages.length
    ? await db
        .select()
        .from(workspaceAction)
        .where(
          inArray(
            workspaceAction.messageId,
            messages.map((row) => row.id),
          ),
        )
        .orderBy(asc(workspaceAction.createdAt))
    : []
  const blocks = messages.length
    ? await db
        .select()
        .from(workspaceUiBlock)
        .where(
          inArray(
            workspaceUiBlock.messageId,
            messages.map((row) => row.id),
          ),
        )
        .orderBy(asc(workspaceUiBlock.createdAt))
    : []
  return { messages, actions, blocks: blocks.map(publicBlock) }
}

export async function beginTurn(
  chatId: string,
  input: {
    content: string
    clientMessageId: string
    blockResponse?: { blockId: string; value: string }
    /** The chat app it was said in (shared threads). */
    via?: tTeamChatApp
  },
) {
  await recoverChat(chatId)
  return db.transaction(async (tx) => {
    await tx
      .select()
      .from(workspaceChat)
      .where(eq(workspaceChat.id, chatId))
      .for('update')
    const [duplicate] = await tx
      .select()
      .from(workspaceMessage)
      .where(
        and(
          eq(workspaceMessage.chatId, chatId),
          eq(workspaceMessage.clientMessageId, input.clientMessageId),
        ),
      )
      .limit(1)
    if (duplicate)
      throw new ApiError(
        409,
        'duplicate_message',
        'Message already received; reload the chat to see its result',
      )
    const [active] = await tx
      .select()
      .from(workspaceMessage)
      .where(
        and(
          eq(workspaceMessage.chatId, chatId),
          eq(workspaceMessage.status, 'running'),
        ),
      )
      .limit(1)
    if (active)
      throw new ApiError(
        409,
        'chat_busy',
        'Wait for the current response to finish',
      )
    let content = input.content
    const pendingBlocks = await tx
      .select()
      .from(workspaceUiBlock)
      .where(
        and(
          eq(workspaceUiBlock.chatId, chatId),
          eq(workspaceUiBlock.status, 'pending'),
        ),
      )
    // Typed exact choices remain usable; ambiguous free text is handled by the next agent turn.
    let response = input.blockResponse
    if (!response) {
      const matches = pendingBlocks.flatMap((block) =>
        (isChoiceBlock(block.payload) ? block.payload.options : [])
          .filter((option) =>
            // A held action (from a chat app) is confirmed only by its
            // button or an exact "yes"; "Cancel" still cancels it.
            block.pendingAction
              ? option.value === 'confirm'
                ? exactYes(content)
                : option.label.toLowerCase() === content.trim().toLowerCase()
              : [option.value, option.label].some(
                  (value) =>
                    value.toLowerCase() === content.trim().toLowerCase(),
                ) ||
                (block.payload.type === 'confirmation' &&
                  option.value === 'confirm' &&
                  /^(yes|yes please|confirm)$/i.test(content.trim())),
          )
          .map((option) => ({ blockId: block.id, value: option.value })),
      )
      if (matches.length === 1) response = matches[0]
    }
    const selected = response
      ? pendingBlocks.find((block) => block.id === response.blockId)
      : undefined
    if (response) {
      if (
        !selected ||
        Date.now() - selected.createdAt.getTime() > 24 * 60 * 60 * 1000
      )
        throw new ApiError(
          409,
          'stale_block',
          'This choice is no longer active. Reload the chat.',
        )
      const payload = selected.payload
      const option = isChoiceBlock(payload)
        ? payload.options.find((option) => option.value === response.value)
        : undefined
      if (!option || !isChoiceBlock(payload))
        throw new ApiError(400, 'invalid_choice', 'Choose an available option')
      content = `${payload.title}: ${option.label}`
    }
    const submittedAt = new Date()
    await tx.insert(workspaceMessage).values({
      chatId,
      content,
      clientMessageId: input.clientMessageId,
      via: input.via,
      role: 'user',
      createdAt: submittedAt,
      completedAt: submittedAt,
    })
    const [reply] = await tx
      .insert(workspaceMessage)
      .values({
        chatId,
        clientMessageId: input.clientMessageId,
        via: input.via,
        role: 'assistant',
        status: 'running',
        createdAt: new Date(submittedAt.getTime() + 1),
      })
      .returning()
    await tx
      .update(workspaceUiBlock)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(workspaceUiBlock.chatId, chatId),
          eq(workspaceUiBlock.status, 'pending'),
        ),
      )
    if (selected && response)
      await tx
        .update(workspaceUiBlock)
        .set({
          status: 'resolved',
          resolvedValue: response.value,
          responseReplyId: reply.id,
          resolvedAt: submittedAt,
        })
        .where(eq(workspaceUiBlock.id, selected.id))
    await tx
      .update(workspaceChat)
      .set({ updatedAt: new Date() })
      .where(eq(workspaceChat.id, chatId))
    return reply
  })
}

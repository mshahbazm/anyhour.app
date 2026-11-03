import { eq } from 'drizzle-orm'
import { teamChatConfig } from '../../config/teamChat.config'
import { db } from '../../db'
import { workspaceMessage } from '../../db/schema'
import { isChoiceBlock } from '../../schemas/workspaceUi.schema'
import type { tWorkspaceEvent } from '../../types/workspaceAgent.types'
import { ApiError } from '../http/apiError'
import { limitPublicRequest } from '../widget/access'
import {
  requireWorkspaceModel,
  workspaceAnswer,
} from '../workspaceAgent/answer'
import { beginTurn } from '../workspaceAgent/store'
import type { tPublicBlock } from '../workspaceAgent/uiBlocks'
import { memberSession } from './actAs'
import type { iTeamChoice, iTeamMessage, iTeamReply } from './adapter'
import { memberOf, ownerThread } from './thread'

// One message from a chat app, answered by the owner assistant exactly as
// the dashboard would: the same tools, skills and the linked member's
// permissions, in the member's thread with the AI.

const say = (text: string): iTeamReply => ({ text, choices: [] })

// Cards the dashboard draws (summaries) as a few lines.
function cardText(block: tPublicBlock) {
  const card = block.payload
  if (card.type === 'summary')
    return [
      `**${card.title}**`,
      ...card.items.map((item) => `- ${item.label}: ${item.value}`),
    ].join('\n')
  return null
}

function choiceOf(block: tPublicBlock): iTeamChoice | null {
  const payload = block.payload
  if (!isChoiceBlock(payload) || block.status !== 'pending') return null
  return {
    blockId: block.id,
    title: payload.title,
    description: payload.description,
    options: payload.options
      .slice(0, teamChatConfig.maxButtons)
      .map((option) => ({ value: option.value, label: option.label })),
    confirmsAction:
      payload.type === 'confirmation' &&
      payload.options.some((option) => option.value === 'confirm'),
  }
}

// Null when the message was already handled (a redelivery).
export async function teamTurn(
  message: iTeamMessage,
  dispatch?: (request: Request) => Response | Promise<Response>,
): Promise<iTeamReply | null> {
  const person = await memberOf(message.memberId)
  if (!person) return say('You’re no longer in this workspace.')
  const thread = await ownerThread(person.userId, person.organizationId)
  if (!thread) return say('Your AI isn’t set up yet.')
  try {
    // The same per-person budget as the dashboard chat.
    await limitPublicRequest(
      {
        assistantId: `workspace-helper:${person.userId}`,
        nonce: person.userId,
        origin: 'workspace',
        expiresAt: 0,
      },
      'message',
      teamChatConfig.messagesPerMinute,
    )
    requireWorkspaceModel()
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    return say(
      error.status === 429
        ? 'You’re sending messages faster than I can answer. Give me a minute.'
        : 'I can’t answer right now. Try again in a little while.',
    )
  }
  const content = message.quoted
    ? `${message.text}\n\n(Replying to this, quoted as data: “${message.quoted.slice(0, 1_500)}”)`
    : message.text
  let reply
  try {
    reply = await beginTurn(thread.id, {
      content: content.slice(0, 8_000),
      clientMessageId: `${message.app}:${message.externalMessageId}`,
      blockResponse: message.choice ?? undefined,
      via: message.app,
    })
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (error.code === 'duplicate_message') return null
    if (error.code === 'chat_busy')
      return say('I’m still answering your last message. One moment.')
    if (error.code === 'stale_block' || error.code === 'invalid_choice')
      return say('That choice isn’t open any more. Ask me again.')
    throw error
  }
  const blocks: tPublicBlock[] = []
  const session = await memberSession(person.userId)
  try {
    const { app } = await import('../../app')
    const stream = workspaceAnswer(
      session.headers,
      dispatch ?? ((request) => app.fetch(request)),
      thread.id,
      reply.id,
      {
        app: message.app,
        listen: (event: tWorkspaceEvent) => {
          if (event.type === 'block') blocks.push(event.block)
        },
      },
    )
    const reader = stream.getReader()
    while (!(await reader.read()).done) {
      // Drained; the listener collects what matters.
    }
  } finally {
    await session.end()
  }
  const [answered] = await db
    .select({
      status: workspaceMessage.status,
      content: workspaceMessage.content,
    })
    .from(workspaceMessage)
    .where(eq(workspaceMessage.id, reply.id))
  const cards = blocks.map(cardText).filter((item): item is string => !!item)
  const text =
    answered?.status === 'completed'
      ? [answered.content, ...cards].filter(Boolean).join('\n\n')
      : 'I stopped before finishing. Check what I did in the dashboard, then try again.'
  return {
    text: text || 'Done.',
    choices: blocks
      .map(choiceOf)
      .filter((item): item is iTeamChoice => item !== null),
  }
}

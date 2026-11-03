import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import { conversation, message } from '../../db/schema'
import { ApiError } from '../http/apiError'
import { extractContactDetails } from '../leads/contactDetails'
import type { tBlockReply } from '../../schemas/chatBlock.schema'
import { withFallback } from './blocks'

export interface iReplyContext {
  replyId: string
  // The visitor message this reply answers.
  visitorMessageId: string
  conversationId: string
  clientMessageId: string
  history: Array<Pick<typeof message.$inferSelect, 'role' | 'content'>>
  // human: a team member has the conversation, so the AI stays quiet.
  handledBy: 'agent' | 'human'
}

type tExecutor = Pick<typeof db, 'select'>

// The last completed turns the AI answers from, oldest first, within
// a character budget (`reserved` is kept for text added after them). Ties on
// time put the AI's reply after the message it answered.
export async function replyHistory(
  executor: tExecutor,
  conversationId: string,
  reserved = 0,
) {
  const recent = await executor
    .select({
      role: message.role,
      content: message.content,
      blocks: message.blocks,
    })
    .from(message)
    .where(
      and(
        eq(message.conversationId, conversationId),
        eq(message.status, 'completed'),
        // Staff replies are the business speaking, like the AI's.
        inArray(message.role, ['visitor', 'assistant', 'staff']),
      ),
    )
    .orderBy(
      desc(message.createdAt),
      desc(
        sql<number>`case when ${message.role} = 'assistant' then 1 else 0 end`,
      ),
      desc(message.id),
    )
    .limit(23)
  let remaining = 32_000 - reserved
  const history: iReplyContext['history'] = []
  for (const item of recent) {
    // The model reads a block as the plain text we wrote for it.
    const content = withFallback(item.content, item.blocks)
    if (content.length > remaining) break
    history.push({ role: item.role, content })
    remaining -= content.length
  }
  return history.reverse()
}

export async function beginReply(
  conversationId: string,
  input: {
    clientMessageId: string
    content: string
    // A tap on one of the AI's blocks, already checked against the
    // block (blocks.ts visitorTurn); `content` is the text we wrote for it.
    blockReply?: tBlockReply | null
  },
): Promise<iReplyContext> {
  return db.transaction(async (tx) => {
    const [chat] = await tx
      .select()
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .for('update')
    if (!chat)
      throw new ApiError(404, 'conversation_missing', 'Conversation not found')
    // Snapshot before accepting this visitor turn, while the conversation lock
    // prevents a newer send from entering this reply's context.
    const { content } = input
    const history = await replyHistory(tx, conversationId, content.length)
    history.push({ role: 'visitor', content })
    const [received] = await tx
      .insert(message)
      .values({
        conversationId,
        role: 'visitor',
        content,
        blockReply: input.blockReply ?? null,
        clientMessageId: input.clientMessageId,
        completedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: message.id })
    if (!received)
      throw new ApiError(409, 'duplicate_message', 'Message already received')
    const details = extractContactDetails([content])
    const email = details.emails[0]
    const phone = details.phones[0]
    await tx
      .update(conversation)
      .set({
        status: 'open',
        closedAt: null,
        lastMessageAt: new Date(),
        // While the team has it, the visitor's message waits in Needs you.
        ...(chat.handledBy === 'human' && !chat.needsHumanSince
          ? { needsHumanSince: new Date() }
          : {}),
        knownFields: {
          ...chat.knownFields,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
        },
      })
      .where(eq(conversation.id, conversationId))
    return {
      history,
      visitorMessageId: received.id,
      replyId: crypto.randomUUID(),
      conversationId,
      clientMessageId: `${input.clientMessageId}:reply`,
      handledBy: chat.handledBy,
    }
  })
}

export async function failReply(
  reply: iReplyContext,
  code: string,
  content = '',
) {
  await db
    .insert(message)
    .values({
      id: reply.replyId,
      conversationId: reply.conversationId,
      clientMessageId: reply.clientMessageId,
      role: 'assistant',
      status: 'failed',
      errorCode: code,
      content,
      completedAt: new Date(),
    })
    .onConflictDoNothing()
}

import { and, desc, eq, lt } from 'drizzle-orm'
import { chatConfig } from '../../config/chat.config'
import { db } from '../../db'
import { conversation, message } from '../../db/schema'
import { createAnswerStream } from '../chat/answer'
import { withFallback } from '../chat/blocks'
import { failReply, replyHistory } from '../chat/messages'
import type { iReplyContext } from '../chat/messages'
import type { tConnection } from '../connections/types'
import { deliverToCustomer } from './send'

// The AI answers a WhatsApp customer with the same answer pipeline
// as the website chat (services/chat), one answer at a time per
// conversation. Jobs for one customer already run one at a time (the job's
// key); the lease below also covers jobs that overlap anyway, without
// holding a database connection while the answer is written. Each reply
// answers the newest message when it starts (its key is `<wamid>:reply`),
// so two quick messages get one answer, and a message that arrives while
// it's being written gets the next one.

// A bookkeeping row (role tool: never shown, never in the model's history)
// that one answer holds at a time. A crashed worker's lease expires.
const leaseKey = 'whatsapp:answering'
const leaseMs = chatConfig.generationTimeoutMs + 60_000

async function takeLease(conversationId: string) {
  const [taken] = await db
    .insert(message)
    .values({
      conversationId,
      role: 'tool',
      content: 'answering',
      clientMessageId: leaseKey,
      completedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: message.id })
  if (taken) return true
  const [expired] = await db
    .update(message)
    .set({ createdAt: new Date() })
    .where(
      and(
        eq(message.conversationId, conversationId),
        eq(message.clientMessageId, leaseKey),
        lt(message.createdAt, new Date(Date.now() - leaseMs)),
      ),
    )
    .returning({ id: message.id })
  return Boolean(expired)
}

const releaseLease = (conversationId: string) =>
  db
    .delete(message)
    .where(
      and(
        eq(message.conversationId, conversationId),
        eq(message.clientMessageId, leaseKey),
      ),
    )

// The newest customer message when the AI should answer it: the
// conversation is the AI's and nothing has answered it yet.
async function unanswered(conversationId: string) {
  const [chat] = await db
    .select()
    .from(conversation)
    .where(eq(conversation.id, conversationId))
  if (!chat?.externalUserId || chat.handledBy === 'human') return null
  const [newest] = await db
    .select()
    .from(message)
    .where(
      and(
        eq(message.conversationId, conversationId),
        eq(message.role, 'visitor'),
      ),
    )
    .orderBy(desc(message.createdAt), desc(message.id))
    .limit(1)
  if (!newest?.clientMessageId) return null
  const replyKey = `${newest.clientMessageId}:reply`
  const [answered] = await db
    .select({ id: message.id })
    .from(message)
    .where(
      and(
        eq(message.conversationId, conversationId),
        eq(message.clientMessageId, replyKey),
      ),
    )
  if (answered) return null
  return {
    chat,
    waId: chat.externalUserId,
    visitorMessageId: newest.id,
    visitorKey: newest.clientMessageId,
    replyKey,
  }
}

async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  while (!(await reader.read()).done) {
    // The reply is saved by the pipeline; the events are for the widget.
  }
}

async function answerNewest(record: tConnection, conversationId: string) {
  const pending = await unanswered(conversationId)
  if (!pending) return
  const { chat } = pending
  const reply: iReplyContext = {
    replyId: crypto.randomUUID(),
    visitorMessageId: pending.visitorMessageId,
    conversationId,
    clientMessageId: pending.replyKey,
    history: await replyHistory(db, conversationId),
    handledBy: 'agent',
  }
  try {
    await drain(
      await createAnswerStream(
        chat.assistantId,
        conversationId,
        pending.visitorKey,
        reply,
        false,
        'whatsapp',
      ),
    )
  } catch (error) {
    await failReply(reply, 'agent_failed')
    throw error
  }
  const [saved] = await db
    .select()
    .from(message)
    .where(eq(message.id, reply.replyId))
  if (
    !saved ||
    saved.status !== 'completed' ||
    (!saved.content.trim() && !saved.blocks.length)
  )
    return
  const delivery = await deliverToCustomer(
    record,
    { conversationId, waId: pending.waId },
    saved,
  )
  // After the window and without a template, the reply waits for the
  // owner in Needs you as the suggested reply.
  if (!delivery.sent && delivery.reason === 'windowClosed')
    await db
      .update(conversation)
      .set({
        handoffDraft: withFallback(saved.content, saved.blocks),
        needsHumanSince: chat.needsHumanSince ?? new Date(),
      })
      .where(eq(conversation.id, conversationId))
}

export async function answerCustomer(
  record: tConnection,
  conversationId: string,
) {
  // Whoever holds the lease answers. After releasing it they look again, so
  // a message saved while they held it (its own job found the lease taken)
  // is never left unanswered.
  while (await takeLease(conversationId)) {
    try {
      await answerNewest(record, conversationId)
    } finally {
      await releaseLease(conversationId)
    }
    if (!(await unanswered(conversationId))) return
  }
}

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { assistant, conversation } from '../../db/schema'
import { ApiError } from '../http/apiError'
import { findBlock } from '../chat/blocks'
import { countChatEvent, countedTracking } from '../insights/collect'
import { siteSettings } from '../widget/site'

// When a website visitor asks for WhatsApp and when they open the WhatsApp
// button (docs/whatsappQuestion.md), once per conversation each. Counted in
// insights only while the owner counts chat.

type tChat = Pick<
  typeof conversation.$inferSelect,
  'id' | 'assistantId' | 'channel' | 'isTest' | 'whatsappAskedAt'
>

async function countIfChatCounted(
  chat: tChat,
  metric: 'whatsappAsks' | 'whatsappOpens',
) {
  if (chat.isTest) return
  const site = await siteSettings(chat.assistantId)
  if (site && countedTracking(site).chat)
    countChatEvent(chat.assistantId, metric)
}

/** A website visitor's message: is it the WhatsApp question? */
export async function noteWhatsappAsk(chat: tChat, content: string) {
  if (chat.channel !== 'widget' || chat.whatsappAskedAt) return
  const [row] = await db
    .select({ appearance: assistant.appearance })
    .from(assistant)
    .where(eq(assistant.id, chat.assistantId))
    .limit(1)
  const question = row?.appearance.whatsapp?.question
  if (
    !question ||
    question.trim().toLowerCase() !== content.trim().toLowerCase()
  )
    return
  const [marked] = await db
    .update(conversation)
    .set({ whatsappAskedAt: new Date() })
    .where(
      and(eq(conversation.id, chat.id), isNull(conversation.whatsappAskedAt)),
    )
    .returning({ id: conversation.id })
  if (marked) await countIfChatCounted(chat, 'whatsappAsks')
}

/** The visitor opened the WhatsApp button `blockId` in this conversation. */
export async function noteWhatsappOpen(chat: tChat, blockId: string) {
  const block = await findBlock(db, chat.id, blockId)
  if (block?.kind !== 'whatsapp')
    throw new ApiError(404, 'block_missing', 'WhatsApp button not found')
  const [marked] = await db
    .update(conversation)
    .set({ whatsappOpenedAt: new Date() })
    .where(
      and(eq(conversation.id, chat.id), isNull(conversation.whatsappOpenedAt)),
    )
    .returning({ id: conversation.id })
  if (marked) await countIfChatCounted(chat, 'whatsappOpens')
}

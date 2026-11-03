import { and, desc, eq } from 'drizzle-orm'
import { customerWhatsappConfig } from '../../config/customerWhatsapp.config'
import { db } from '../../db'
import { message } from '../../db/schema'
import type { tChatBlock } from '../../schemas/chatBlock.schema'
import { withFallback } from '../chat/blocks'
import { ConnectionError } from '../connections/errors'
import { markConnection, noteConnectionError } from '../connections/store'
import type { tConnection } from '../connections/types'
import {
  whatsappBusinessActions,
  whatsappBusinessToken,
} from '../connections/whatsappBusinessApi'
import { whatsappReply } from './blocks'

// Sending to a customer on WhatsApp, for the AI and for staff
// replies. Free text (and a block's buttons or list) only inside the
// 24-hour customer service window; after it, only the approved template set
// on Channels, or nothing.

/** When the customer last wrote: the window runs from there. */
export async function lastCustomerMessageAt(conversationId: string) {
  const [row] = await db
    .select({ createdAt: message.createdAt })
    .from(message)
    .where(
      and(
        eq(message.conversationId, conversationId),
        eq(message.role, 'visitor'),
      ),
    )
    .orderBy(desc(message.createdAt))
    .limit(1)
  return row?.createdAt ?? null
}

export function windowOpen(lastCustomerAt: Date | null, now = Date.now()) {
  return (
    lastCustomerAt !== null &&
    now - lastCustomerAt.getTime() <
      customerWhatsappConfig.windowHours * 3_600_000
  )
}

/** The reply as WhatsApp shows it: Markdown links and emphasis made plain. */
export function plainText(text: string) {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) =>
      label === url ? url : `${label}: ${url}`,
    )
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim()
}

// A template variable is one line.
const templateText = (text: string) =>
  plainText(text)
    .replace(/\s+/g, ' ')
    .slice(0, customerWhatsappConfig.templateTextChars)

export type tDelivery =
  | { sent: true; externalId: string }
  | { sent: false; reason: 'windowClosed' | 'failed'; message: string }

/**
 * Sends a stored message to the conversation's customer and records the
 * result on it. Never throws for WhatsApp's refusals: the message is marked
 * failed and the connection noted (or broken on a revoked token).
 */
export async function deliverToCustomer(
  record: tConnection,
  customer: { conversationId: string; waId: string },
  outgoing: { id: string; content: string; blocks?: tChatBlock[] },
): Promise<tDelivery> {
  const numberId = record.externalAccountId
  const template = record.settings.templateName
  const open = windowOpen(await lastCustomerMessageAt(customer.conversationId))
  const fail = async (errorCode: string) =>
    db
      .update(message)
      .set({ deliveryStatus: 'failed', errorCode })
      .where(eq(message.id, outgoing.id))
  if (!open && !template) {
    await fail('whatsapp_window_closed')
    return {
      sent: false,
      reason: 'windowClosed',
      message: 'More than 24 hours since they last wrote',
    }
  }
  try {
    const token = whatsappBusinessToken(record)
    const blocks = outgoing.blocks ?? []
    const reply = whatsappReply(plainText(outgoing.content), blocks)
    const externalId = !open
      ? await whatsappBusinessActions.sendTemplate(
          numberId,
          token,
          customer.waId,
          {
            name: template!,
            language: record.settings.templateLanguage ?? 'en',
          },
          // A block goes into the template as its numbered text.
          templateText(withFallback(outgoing.content, blocks)),
        )
      : reply.type === 'interactive'
        ? await whatsappBusinessActions.sendInteractive(
            numberId,
            token,
            customer.waId,
            reply.interactive,
          )
        : await whatsappBusinessActions.sendText(
            numberId,
            token,
            customer.waId,
            reply.text,
          )
    await db
      .update(message)
      .set({ externalId, deliveryStatus: 'sent' })
      .where(eq(message.id, outgoing.id))
    if (record.lastError) await noteConnectionError(record, null)
    return { sent: true, externalId }
  } catch (error) {
    if (!(error instanceof ConnectionError)) throw error
    await fail(`whatsapp_${error.failure}`)
    if (error.breaksConnection)
      await markConnection(record, 'broken', error.message)
    else await noteConnectionError(record, error.message)
    // The reason only: never the token or the customer's text.
    console.error('WhatsApp send failed', error.failure)
    return { sent: false, reason: 'failed', message: error.message }
  }
}

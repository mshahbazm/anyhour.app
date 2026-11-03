import { createHash, randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { contact, conversation, message } from '../../db/schema'
import {
  lockIdentities,
  matchingIdentities,
  normalizePhone,
  recordIdentity,
} from '../contacts/identities'
import type { tConnection } from '../connections/types'
import type {
  iWhatsappInbound,
  iWhatsappStatus,
} from '../connections/whatsappBusiness'
import { windowClosedError } from '../connections/whatsappBusinessApi'
import { tappedBlock } from './blocks'
import { answerCustomer } from './reply'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

const maxTextChars = 4_000

// v1 reads text only. Photos, documents, voice notes and the rest are noted
// in words, and the AI asks for text (playbooks/whatsapp.md).
const mediaWords: Record<string, string> = {
  image: '[image]',
  video: '[video]',
  audio: '[voice note]',
  document: '[document]',
  sticker: '[sticker]',
  location: '[location]',
  contacts: '[contact card]',
}

export function inboundText(item: iWhatsappInbound) {
  let text: string | undefined
  if (item.type === 'text') text = item.text?.body
  else if (item.type === 'button') text = item.button?.text
  else if (item.type === 'interactive')
    text =
      item.interactive?.button_reply?.title ??
      item.interactive?.list_reply?.title
  else {
    const caption =
      item.image?.caption ?? item.video?.caption ?? item.document?.caption
    text = [mediaWords[item.type] ?? '[a message WhatsApp can’t show]', caption]
      .filter(Boolean)
      .join(' ')
  }
  const trimmed = text?.trim()
  return trimmed ? trimmed.slice(0, maxTextChars) : null
}

// The contact for a WhatsApp number: whoever already has it (as WhatsApp or
// phone), or a new contact named as their WhatsApp profile.
//
// The sender's number is verified by Meta: unlike an email or phone typed in
// the website chat, the customer can't claim someone else's. It's the first
// verified identity we have. Contact facts still stay owner-only for now:
// the AI's prompt never gets them on any channel (visitorPrompt.ts,
// docs/contacts.md) until we decide verified identities may relax that.
async function contactFor(
  tx: tTransaction,
  organizationId: string,
  phone: string,
  profileName: string | null,
) {
  const identity = { kind: 'whatsapp' as const, normalizedValue: phone }
  await lockIdentities(tx, organizationId, [identity])
  const owners = await matchingIdentities(tx, organizationId, [identity])
  let contactId = owners[0]?.contactId
  if (!contactId) {
    const [byPhone] = await tx
      .select({ id: contact.id })
      .from(contact)
      .where(
        and(
          eq(contact.organizationId, organizationId),
          eq(contact.normalizedPhone, phone),
        ),
      )
    contactId =
      byPhone?.id ??
      (
        await tx
          .insert(contact)
          .values({
            organizationId,
            name: profileName?.trim().slice(0, 120) || null,
            phone,
            normalizedPhone: phone,
          })
          .returning({ id: contact.id })
      )[0].id
  }
  if (!owners.some((item) => item.kind === 'whatsapp'))
    await recordIdentity(tx, {
      organizationId,
      contactId,
      ...identity,
      value: phone,
      source: 'chat',
    })
  return contactId
}

// One customer message: their contact and conversation (one per number and
// customer), the message once, then the AI's answer unless the
// team has the conversation.
export async function receiveCustomerMessage(
  record: tConnection,
  item: iWhatsappInbound,
  profileName: string | null,
) {
  if (record.status !== 'active' || !record.assistantId) return
  const assistantId = record.assistantId
  const text = inboundText(item)
  if (!text) return
  let phone: string
  try {
    phone = normalizePhone(`+${item.from}`)
  } catch {
    return
  }
  const received = await db.transaction(async (tx) => {
    const contactId = await contactFor(
      tx,
      record.organizationId,
      phone,
      profileName,
    )
    let [chat] = await tx
      .select()
      .from(conversation)
      .where(
        and(
          eq(conversation.connectionId, record.id),
          eq(conversation.externalUserId, item.from),
        ),
      )
      .for('update')
    if (!chat)
      [chat] = await tx
        .insert(conversation)
        .values({
          assistantId,
          contactId,
          channel: 'whatsapp',
          connectionId: record.id,
          externalUserId: item.from,
          // Unused on WhatsApp; the column is required.
          resumeTokenHash: createHash('sha256')
            .update(randomBytes(32))
            .digest('hex'),
          knownFields: { phone },
        })
        .returning()
    // A tap on one of the AI's buttons or list rows reads as the
    // option and keeps which block it answered.
    const tapped =
      item.type === 'interactive'
        ? await tappedBlock(
            tx,
            chat.id,
            item.interactive?.button_reply?.id ??
              item.interactive?.list_reply?.id,
          )
        : null
    const [saved] = await tx
      .insert(message)
      .values({
        conversationId: chat.id,
        role: 'visitor',
        content: tapped?.text ?? text,
        blockReply: tapped?.blockReply ?? null,
        clientMessageId: item.id,
        externalId: item.id,
        completedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: message.id })
    if (!saved) return null
    await tx
      .update(conversation)
      .set({
        status: 'open',
        closedAt: null,
        lastMessageAt: new Date(),
        contactId: chat.contactId ?? contactId,
        // While the team has it, the message waits for them in Needs you.
        ...(chat.handledBy === 'human' && !chat.needsHumanSince
          ? { needsHumanSince: new Date() }
          : {}),
      })
      .where(eq(conversation.id, chat.id))
    return chat
  })
  if (!received || received.handledBy === 'human') return
  await answerCustomer(record, received.id)
}

const deliveryRank = { sent: 1, delivered: 2, read: 3 } as const

// Meta's status webhooks: sent, delivered, read, or failed with a reason.
export async function receiveDeliveryStatus(
  record: tConnection,
  status: iWhatsappStatus,
) {
  const next = status.status
  if (next !== 'failed' && !(next in deliveryRank)) return
  const [row] = await db
    .select({ id: message.id, deliveryStatus: message.deliveryStatus })
    .from(message)
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .where(
      and(
        eq(message.externalId, status.id),
        eq(conversation.connectionId, record.id),
      ),
    )
  if (!row || row.deliveryStatus === 'failed') return
  if (next === 'failed') {
    const code = status.errors?.[0]?.code
    await db
      .update(message)
      .set({
        deliveryStatus: 'failed',
        errorCode:
          code === windowClosedError
            ? 'whatsapp_window_closed'
            : `whatsapp_${code ?? 'failed'}`,
      })
      .where(eq(message.id, row.id))
    return
  }
  const rank = deliveryRank[next as keyof typeof deliveryRank]
  const current = row.deliveryStatus
    ? deliveryRank[row.deliveryStatus as keyof typeof deliveryRank]
    : 0
  if (rank > current)
    await db
      .update(message)
      .set({ deliveryStatus: next as keyof typeof deliveryRank })
      .where(eq(message.id, row.id))
}

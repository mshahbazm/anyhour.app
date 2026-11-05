import { randomBytes } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { message } from '../../db/schema'
import { chatBlockSchema } from '../../schemas/chatBlock.schema'
import type {
  tBlockContact,
  tBlockInput,
  tBlockReply,
  tChatBlock,
} from '../../schemas/chatBlock.schema'
import { normalizePhone } from '../contacts/identities'
import { ApiError } from '../http/apiError'
import {
  whatsappButton,
  whatsappButtonMissing,
} from '../../config/whatsappQuestion.config'
import { whatsappUrl } from '../whatsappQuestion/number'

// Chat UI blocks (docs/channels.md, wave 4): turning what the model asked
// for into a stored block, the plain-text fallback we write for it, and
// reading a visitor's tap back.

type tExecutor = Pick<typeof db, 'select'>
type tBlockWithoutFallback = tChatBlock extends infer T
  ? T extends tChatBlock
    ? Omit<T, 'fallback'>
    : never
  : never

const contactQuestions = {
  email: 'What’s the best email address to reach you?',
  phone: 'What’s the best phone number to reach you?',
  emailOrPhone: 'What’s the best email or phone number to reach you?',
} as const

/** The block as plain text: for WhatsApp, the model's history and the inbox. */
export function blockFallback(block: tBlockWithoutFallback) {
  switch (block.kind) {
    case 'choices':
    case 'list':
      return block.options
        .map(
          (item, index) =>
            `${index + 1}. ${item.label}${item.description ? ` (${item.description})` : ''}`,
        )
        .join('\n')
    case 'checklist':
      return [
        `${block.title}:`,
        ...block.items.map(
          (item, index) =>
            `${index + 1}. ${item.text}${item.done ? ' (done)' : ''}`,
        ),
      ].join('\n')
    case 'contactForm':
      return contactQuestions[block.ask]
    case 'whatsapp':
      return `Chat with us on WhatsApp: ${block.url}`
  }
}

const blockId = () => `b_${randomBytes(9).toString('base64url')}`

export type tResolvedBlock =
  { ok: true; block: tChatBlock } | { ok: false; reason: string }

/** Where the reply goes, for blocks that depend on it. */
export interface iBlockContext {
  channel: 'widget' | 'whatsapp'
  /** Whether the owner added the WhatsApp question. */
  whatsappQuestion: boolean
  /**
   * The business's WhatsApp number at send time (whatsappQuestion/
   * knownNumber.ts), when one is known.
   */
  whatsappNumber: string | null
}

/** The stored block for what the model sent, or why it can't be shown. */
export function resolveBlock(
  input: tBlockInput,
  context: iBlockContext,
): tResolvedBlock {
  let block: tBlockWithoutFallback
  const id = blockId()
  if (input.kind === 'whatsapp') {
    if (context.channel === 'whatsapp')
      return { ok: false, reason: whatsappButtonMissing.onWhatsapp }
    if (!context.whatsappQuestion)
      return { ok: false, reason: whatsappButtonMissing.question }
    if (!context.whatsappNumber)
      return { ok: false, reason: whatsappButtonMissing.number }
    block = {
      id,
      kind: 'whatsapp',
      label: whatsappButton.label,
      url: whatsappUrl(context.whatsappNumber),
    }
  } else if (input.kind === 'choices' || input.kind === 'list') {
    const labels = input.options.map((item) => item.label.trim())
    if (
      new Set(labels.map((item) => item.toLowerCase())).size !== labels.length
    )
      return { ok: false, reason: 'Each option needs a different label.' }
    const options = input.options.map((item) => ({
      label: item.label.trim(),
      value: item.label.trim(),
      ...(input.kind === 'list' && 'description' in item && item.description
        ? { description: item.description.trim() }
        : {}),
    }))
    block =
      input.kind === 'choices'
        ? { id, kind: 'choices', options }
        : {
            id,
            kind: 'list',
            buttonLabel: input.buttonLabel?.trim() || 'Choose',
            options,
          }
  } else if (input.kind === 'checklist') {
    block = { id, kind: 'checklist', title: input.title, items: input.items }
  } else {
    block = {
      id,
      kind: 'contactForm',
      ask: input.ask,
      askName: input.askName,
      topic: input.topic,
    }
  }
  const parsed = chatBlockSchema.safeParse({
    ...block,
    fallback: blockFallback(block),
  })
  return parsed.success
    ? { ok: true, block: parsed.data }
    : { ok: false, reason: 'That block is not valid.' }
}

/** A reply's text with its block written out, as the model reads it later. */
export function withFallback(content: string, blocks: tChatBlock[]) {
  const block = blocks[0]
  return block
    ? [content.trim(), block.fallback].filter(Boolean).join('\n\n')
    : content
}

/** What the visitor's message reads as after tapping `value` on `block`. */
export function blockReplyText(block: tChatBlock, value: string) {
  if (block.kind === 'choices' || block.kind === 'list')
    return block.options.find((item) => item.value === value)?.label ?? null
  return null
}

/** The AI's block with this id in this conversation. */
export async function findBlock(
  executor: tExecutor,
  conversationId: string,
  id: string,
) {
  const [row] = await executor
    .select({ blocks: message.blocks })
    .from(message)
    .where(
      and(
        eq(message.conversationId, conversationId),
        eq(message.role, 'assistant'),
        sql`${message.blocks} @> ${JSON.stringify([{ id }])}::jsonb`,
      ),
    )
    .orderBy(desc(message.createdAt))
    .limit(1)
  return row?.blocks.find((item) => item.id === id) ?? null
}

/**
 * A tap on a choice or list option: the readable text the visitor's
 * message stores, or null when the block or value isn't one we sent.
 */
export async function resolveBlockReply(
  executor: tExecutor,
  conversationId: string,
  reply: tBlockReply,
) {
  const block = await findBlock(executor, conversationId, reply.blockId)
  const text = block && blockReplyText(block, reply.value)
  return text ? { block, text } : null
}

/**
 * A visitor's message from the widget: plain text, a tap (stored as the
 * text we wrote for it), or the contact form (its details as readable
 * lines, checked against what the form asked for).
 */
export async function visitorTurn(
  conversationId: string,
  input: {
    content: string
    blockReply?: tBlockReply
    contact?: tBlockContact
  },
) {
  if (input.contact) {
    const block =
      input.blockReply &&
      (await findBlock(db, conversationId, input.blockReply.blockId))
    if (block?.kind !== 'contactForm')
      throw new ApiError(
        422,
        'contact_form_missing',
        'This form is no longer available',
      )
    const name = input.contact.name?.trim() || undefined
    const email = input.contact.email?.trim() || undefined
    const phone = input.contact.phone?.trim() || undefined
    if (phone) normalizePhone(phone)
    const missing =
      (block.ask === 'email' && !email) ||
      (block.ask === 'phone' && !phone) ||
      (block.ask === 'emailOrPhone' && !email && !phone)
    if (missing)
      throw new ApiError(
        422,
        'contact_required',
        block.ask === 'phone' ? 'Phone is required' : 'Email is required',
      )
    return {
      content: [
        name && `Name: ${name}`,
        email && `Email: ${email}`,
        phone && `Phone: ${phone}`,
      ]
        .filter(Boolean)
        .join('\n'),
      blockReply: { blockId: block.id, value: 'sent' },
      contact: { topic: block.topic, name, email, phone },
    }
  }
  const tapped =
    input.blockReply &&
    (await resolveBlockReply(db, conversationId, input.blockReply))
  // A tap we can't match to a block we sent is kept as the text it carried.
  return tapped
    ? { content: tapped.text, blockReply: input.blockReply!, contact: null }
    : { content: input.content, blockReply: null, contact: null }
}

// Mirrors packages/api/src/types/support.types.ts (the inbox half).
import type { tChatBlock } from '@anyhour/widget'

export type tConversationChannel = 'widget' | 'whatsapp' | 'email'
export type tHandledBy = 'agent' | 'human'
export const inboxFilters = ['needsYou', 'aiHandling', 'closed', 'all'] as const
export type tInboxFilter = (typeof inboxFilters)[number]

export interface iHandoffSummary {
  reason: 'asked_for_person' | 'problem' | 'not_sure' | 'money'
  wants: string
  known: string | null
  nextStep: string | null
}

export interface iInboxContact {
  id: string
  name: string | null
  email: string | null
  phone: string | null
}

export interface iInboxItem {
  id: string
  assistantId: string
  assistantName: string
  channel: tConversationChannel
  status: 'open' | 'closed'
  handledBy: tHandledBy
  needsHumanSince: string | null
  assignedMemberId: string | null
  contact: iInboxContact | null
  lastMessage: {
    role: 'visitor' | 'assistant' | 'staff'
    content: string
    createdAt: string
  } | null
  lastMessageAt: string | null
  createdAt: string
}

export interface iInboxMessage {
  id: string
  role: 'visitor' | 'assistant' | 'staff'
  content: string
  status: 'pending' | 'completed' | 'failed'
  /** WhatsApp: where an outgoing message got to; null on the website chat. */
  deliveryStatus: 'sent' | 'delivered' | 'read' | 'failed' | null
  /** Your AI's tappable block under its reply (at most one). */
  blocks: tChatBlock[]
  /** A visitor's tap or contact form answering a block. */
  blockReply: { blockId: string; value: string } | null
  staff: { id: string; name: string } | null
  /** A staff reply your AI offers to remember as a note, until answered. */
  noteOffer: iNoteOffer | null
  createdAt: string
}

// Mirrors iNoteOffer in packages/api/src/db/schema/product/message.ts.
export interface iNoteOffer {
  title: string
  text: string
}

export interface iInboxConversation {
  conversation: Omit<iInboxItem, 'lastMessage'> & {
    entryUrl: string | null
    closedAt: string | null
    handoffSummary: iHandoffSummary | null
    handoffDraft: string | null
    leadIds: string[]
    /** The visitor tapped the WhatsApp question. */
    whatsappAskedAt?: string | null
    /** The visitor opened the WhatsApp button. */
    whatsappOpenedAt?: string | null
  }
  messages: iInboxMessage[]
}

export interface iSupportAttention {
  conversations: Array<{
    id: string
    contactName: string | null
    assistantName: string
    needsHumanSince: string | null
    handledBy: tHandledBy
    wants: string | null
    lastVisitorMessage: string | null
  }>
  count: number
}

/** "Sara Malik", their email, or "Visitor". */
export function visitorLabel(contact: iInboxContact | null) {
  return contact?.name || contact?.email || contact?.phone || 'Visitor'
}

/** "Waiting 5 min", "Waiting 2 h", "Waiting 3 d". */
export function waitingFor(since: string, now = Date.now()) {
  const minutes = Math.max(
    0,
    Math.floor((now - new Date(since).getTime()) / 60_000),
  )
  if (minutes < 1) return 'Waiting now'
  if (minutes < 60) return `Waiting ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Waiting ${hours} h`
  return `Waiting ${Math.floor(hours / 24)} d`
}

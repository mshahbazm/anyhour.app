// HTTP contracts for the inbox: conversations as the team sees them
// (docs/support.md).
import type { tBlockReply, tChatBlock } from '../schemas/chatBlock.schema'
import type { iNoteOffer } from '../db/schema/product/message'

export type { iNoteOffer }

export type tConversationChannel = 'widget' | 'whatsapp' | 'email'
export type tHandledBy = 'agent' | 'human'
export type tInboxFilter = 'needsYou' | 'aiHandling' | 'closed' | 'all'

// What the AI wrote when it passed the conversation to a person.
export interface iHandoffSummary {
  reason: 'asked_for_person' | 'problem' | 'not_sure' | 'money'
  wants: string
  known: string | null
  nextStep: string | null
}

export interface iMemberSummary {
  id: string
  name: string
}

// GET /organizations/:organizationId/conversations?filter=&cursor= (X-Next-Cursor),
// newest activity first.
export interface iInboxItem {
  id: string
  assistantId: string
  assistantName: string
  channel: tConversationChannel
  status: 'open' | 'closed'
  handledBy: tHandledBy
  needsHumanSince: string | null
  assignedMemberId: string | null
  contact: {
    id: string
    name: string | null
    email: string | null
    phone: string | null
  } | null
  // The latest visitor, AI or staff message, cut to 200 characters.
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
  // WhatsApp: where an outgoing message got to; null on the website chat.
  deliveryStatus: 'sent' | 'delivered' | 'read' | 'failed' | null
  // The AI's chat UI block, shown read-only (at most one).
  blocks: tChatBlock[]
  // A visitor's tap or contact form answering a block.
  blockReply: tBlockReply | null
  // Who on the team wrote a staff message.
  staff: iMemberSummary | null
  // A staff reply the AI offers to remember as a note, until answered
  // (docs/support.md, "Your replies teach the AI").
  noteOffer: iNoteOffer | null
  createdAt: string
}

// GET /organizations/:organizationId/conversations/:conversationId
export interface iInboxConversation {
  conversation: Omit<iInboxItem, 'lastMessage'> & {
    entryUrl: string | null
    closedAt: string | null
    handoffSummary: iHandoffSummary | null
    // The AI's suggested reply, for the composer.
    handoffDraft: string | null
    leadIds: string[]
    // The WhatsApp question (docs/whatsappQuestion.md): when the visitor
    // asked for WhatsApp and when they opened the WhatsApp button.
    whatsappAskedAt: string | null
    whatsappOpenedAt: string | null
  }
  messages: iInboxMessage[]
}

// Inside GET /organizations/:organizationId/attention.
export interface iSupportAttention {
  // Conversations waiting for a person, longest wait first.
  conversations: Array<{
    id: string
    contactName: string | null
    assistantName: string
    needsHumanSince: string | null
    handledBy: tHandledBy
    wants: string | null
    lastVisitorMessage: string | null
  }>
  // How many: the inbox badge.
  count: number
}

// GET /organizations/:organizationId/attention: what needs the team now.
export interface iAttention {
  support: iSupportAttention
}

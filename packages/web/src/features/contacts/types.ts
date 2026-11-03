// Mirrors packages/api/src/types/contact.types.ts.
import type { iLeadActivity } from '../leads/api'
import type { tLeadStatus } from '../leads/status'

export type tContactIdentityKind = 'email' | 'phone' | 'whatsapp'
export type tLeadContactRole =
  'requester' | 'decision_maker' | 'point_of_contact' | 'billing' | 'other'
/** The roles a person can be given; the requester is set by the lead. */
export type tAddedRole = Exclude<tLeadContactRole, 'requester'>

export interface iContact {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  createdAt: string
  updatedAt: string
}

/** One contact drafted from the owner's words; saved with createContact. */
export interface iContactDraft {
  name: string | null
  email: string | null
  phone: string | null
  facts: string[]
}

export interface iContactListItem extends iContact {
  openDealCount: number
  identityKinds: tContactIdentityKind[]
  lastActivityAt: string | null
}

export interface iContactIdentity {
  id: string
  contactId: string
  kind: tContactIdentityKind
  value: string
  source: 'chat' | 'manual' | 'merge' | 'backfill'
  createdAt: string
}

export interface iContactFact {
  id: string
  contactId: string
  text: string
  /** agent: learned from a conversation; member: written by a person. */
  source: 'agent' | 'member'
  conversationId: string | null
  createdAt: string
  updatedAt: string
}

export interface iContactDeal {
  id: string
  title: string
  role: tLeadContactRole
  isOpen: boolean
  closedAt: string | null
  createdAt: string
  status: tLeadStatus
}

export interface iContactConversation {
  id: string
  assistantId: string
  assistantName: string
  status: 'open' | 'closed'
  createdAt: string
  lastMessageAt: string | null
  lastMessage: {
    role: 'visitor' | 'assistant' | 'staff'
    content: string
    createdAt: string
  } | null
}

export interface iContactActivity extends iLeadActivity {
  leadId: string
  leadTitle: string
}

export interface iContactDetail {
  contact: iContact
  identities: iContactIdentity[]
  facts: iContactFact[]
  deals: iContactDeal[]
  conversations: iContactConversation[]
  activities: iContactActivity[]
}

/** A person on a lead, the requester first. */
export interface iLeadContact {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  role: tLeadContactRole
}

export const roleLabels: Record<tLeadContactRole, string> = {
  requester: 'Made the request',
  decision_maker: 'Decision maker',
  point_of_contact: 'Point of contact',
  billing: 'Billing',
  other: 'Other',
}

export const addedRoles: tAddedRole[] = [
  'decision_maker',
  'point_of_contact',
  'billing',
  'other',
]

export const identityLabels: Record<tContactIdentityKind, string> = {
  email: 'Email',
  phone: 'Phone',
  whatsapp: 'WhatsApp',
}

/** The best name to show for a person, never blank. */
export function contactLabel(
  person: Pick<iContact, 'name' | 'email' | 'phone'>,
) {
  return person.name || person.email || person.phone || 'Unnamed contact'
}

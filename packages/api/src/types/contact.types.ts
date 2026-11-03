// HTTP contracts for contacts, their identities, facts and deals.
import type { tLeadStatus } from '../db/schema/product/lead'
import type { iLeadActivity } from './lead.types'
import type { iDraftMissing } from './draft.types'

export type tContactIdentityKind = 'email' | 'phone' | 'whatsapp'
export type tContactIdentitySource = 'chat' | 'manual' | 'merge' | 'backfill'
export type tLeadContactRole =
  'requester' | 'decision_maker' | 'point_of_contact' | 'billing' | 'other'

// email and phone are display values: one of the contact's identities of
// that kind when it has one.
export interface iContact {
  id: string
  organizationId: string
  name: string | null
  email: string | null
  normalizedEmail: string | null
  phone: string | null
  normalizedPhone: string | null
  createdAt: string
  updatedAt: string
}

// GET /organizations/:organizationId/contacts?q=&cursor=&limit=
// (newest first; the next page's cursor is in X-Next-Cursor)
export interface iContactListItem extends iContact {
  // Open, unmerged deals the contact is on in any role.
  openDealCount: number
  identityKinds: tContactIdentityKind[]
  // Latest deal activity or conversation message; null when none.
  lastActivityAt: string | null
}

export interface iContactIdentity {
  id: string
  contactId: string
  kind: tContactIdentityKind
  value: string
  normalizedValue: string
  source: tContactIdentitySource
  createdAt: string
}

export interface iContactFact {
  id: string
  contactId: string
  text: string
  // agent: learned from a conversation; member: written by a person.
  source: 'agent' | 'member'
  conversationId: string | null
  createdByMemberId: string | null
  createdAt: string
  updatedAt: string
}

// A deal (lead) the contact is on, with their role in it.
export interface iContactDeal {
  id: string
  title: string
  role: tLeadContactRole
  isOpen: boolean
  closedAt: string | null
  createdAt: string
  status: tLeadStatus
  service: { id: string; name: string } | null
}

export interface iContactConversation {
  id: string
  assistantId: string
  assistantName: string
  status: 'open' | 'closed'
  createdAt: string
  lastMessageAt: string | null
  // The latest visitor, assistant or staff message, cut to 200 characters.
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

// GET /organizations/:organizationId/contacts/:contactId, and the merge result
export interface iContactDetail {
  contact: iContact
  identities: iContactIdentity[]
  facts: iContactFact[]
  deals: iContactDeal[]
  conversations: iContactConversation[]
  // The latest 20 across its deals, newest first.
  activities: iContactActivity[]
}

// POST .../contacts/:contactId/identities when another contact has it (409).
export interface iIdentityTakenError {
  error: {
    code: 'identity_taken'
    message: string
    contactId: string
    contactName: string | null
  }
}

// A person on a lead (lead list, lead detail and lead contact routes).
export interface iLeadContact {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  role: tLeadContactRole
}

// One contact drafted from the owner's text. Saving it is the create route,
// then the facts route.
export interface iContactDraft {
  name: string | null
  email: string | null
  phone: string | null
  // Short, durable facts to remember about them.
  facts: string[]
}

// POST /organizations/:organizationId/contacts/drafts
export interface iContactDrafts {
  draft: iContactDraft
  missing: iDraftMissing[]
}

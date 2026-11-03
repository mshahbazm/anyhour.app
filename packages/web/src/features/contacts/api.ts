import { api } from '../workspace/api'
import type { iDraftMissing } from '../workspace/types'
import type {
  iContact,
  iContactDetail,
  iContactDraft,
  iContactFact,
  iContactIdentity,
  iContactListItem,
  iLeadContact,
  tAddedRole,
  tContactIdentityKind,
} from './types'

const base = (organizationId: string) => `/api/organizations/${organizationId}`
const contactPath = (organizationId: string, contactId: string) =>
  `${base(organizationId)}/contacts/${encodeURIComponent(contactId)}`
const query = (q: string) =>
  q.trim() ? `?q=${encodeURIComponent(q.trim())}&limit=20` : '?limit=20'

export const contactsPath = (organizationId: string, q = '') =>
  `${base(organizationId)}/contacts${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`

/** The first page only: for pickers that search as you type. */
export const searchContacts = (organizationId: string, q: string) =>
  api<iContactListItem[]>(`${base(organizationId)}/contacts${query(q)}`)

/** Drafts one contact from free text; saves nothing. */
export const draftContact = (organizationId: string, text: string) =>
  api<{ draft: iContactDraft; missing: iDraftMissing[] }>(
    `${base(organizationId)}/contacts/drafts`,
    { method: 'POST', body: JSON.stringify({ text }) },
  )

/** A 409 identity_taken names the contact that already has the email or phone. */
export const createContact = (
  organizationId: string,
  input: {
    name?: string | null
    email?: string | null
    phone?: string | null
  },
) =>
  api<iContact>(`${base(organizationId)}/contacts`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

export const getContact = (organizationId: string, contactId: string) =>
  api<iContactDetail>(contactPath(organizationId, contactId))

export const updateContact = (
  organizationId: string,
  contactId: string,
  input: { name?: string | null },
) =>
  api<iContact>(contactPath(organizationId, contactId), {
    method: 'PATCH',
    body: JSON.stringify(input),
  })

export const addIdentity = (
  organizationId: string,
  contactId: string,
  input: { kind: tContactIdentityKind; value: string },
) =>
  api<iContactIdentity>(
    `${contactPath(organizationId, contactId)}/identities`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )

export const removeIdentity = (
  organizationId: string,
  contactId: string,
  identityId: string,
) =>
  api<undefined>(
    `${contactPath(organizationId, contactId)}/identities/${encodeURIComponent(identityId)}`,
    { method: 'DELETE' },
  )

export const mergeContact = (
  organizationId: string,
  contactId: string,
  sourceContactId: string,
) =>
  api<iContactDetail>(`${contactPath(organizationId, contactId)}/merge`, {
    method: 'POST',
    body: JSON.stringify({ sourceContactId }),
  })

export const addFact = (
  organizationId: string,
  contactId: string,
  text: string,
) =>
  api<iContactFact>(`${contactPath(organizationId, contactId)}/facts`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })

export const updateFact = (
  organizationId: string,
  contactId: string,
  factId: string,
  text: string,
) =>
  api<iContactFact>(
    `${contactPath(organizationId, contactId)}/facts/${encodeURIComponent(factId)}`,
    { method: 'PATCH', body: JSON.stringify({ text }) },
  )

export const deleteFact = (
  organizationId: string,
  contactId: string,
  factId: string,
) =>
  api<undefined>(
    `${contactPath(organizationId, contactId)}/facts/${encodeURIComponent(factId)}`,
    { method: 'DELETE' },
  )

// The people on a lead. Each change answers with the lead's whole list.
const leadContactsPath = (organizationId: string, leadId: string) =>
  `${base(organizationId)}/leads/${encodeURIComponent(leadId)}/contacts`

export const addLeadContact = (
  organizationId: string,
  leadId: string,
  input: { contactId: string; role: tAddedRole },
) =>
  api<iLeadContact[]>(leadContactsPath(organizationId, leadId), {
    method: 'POST',
    body: JSON.stringify(input),
  })

export const updateLeadContact = (
  organizationId: string,
  leadId: string,
  contactId: string,
  role: tAddedRole,
) =>
  api<iLeadContact[]>(
    `${leadContactsPath(organizationId, leadId)}/${encodeURIComponent(contactId)}`,
    { method: 'PATCH', body: JSON.stringify({ role }) },
  )

export const removeLeadContact = (
  organizationId: string,
  leadId: string,
  contactId: string,
) =>
  api<undefined>(
    `${leadContactsPath(organizationId, leadId)}/${encodeURIComponent(contactId)}`,
    { method: 'DELETE' },
  )

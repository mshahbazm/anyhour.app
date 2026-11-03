import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import { contact, lead, leadContact } from '../../db/schema'
import type { tLeadContactRole } from '../../db/schema/product/leadContact'
import { writeActivity } from './activity'
import { ApiError } from '../http/apiError'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type tDatabase = typeof db | tTransaction

const roleLabel = (role: tLeadContactRole) => role.replaceAll('_', ' ')
const displayName = (person: {
  name: string | null
  email: string | null
  phone: string | null
}) => person.name || person.email || person.phone || 'a contact'

// The people on each lead, the requester first.
export async function leadContactsOf(database: tDatabase, leadIds: string[]) {
  const people = new Map<
    string,
    Array<{
      id: string
      name: string | null
      email: string | null
      phone: string | null
      role: tLeadContactRole
    }>
  >(leadIds.map((id) => [id, []]))
  if (!leadIds.length) return people
  const rows = await database
    .select({
      leadId: leadContact.leadId,
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      role: leadContact.role,
    })
    .from(leadContact)
    .innerJoin(contact, eq(contact.id, leadContact.contactId))
    .where(inArray(leadContact.leadId, leadIds))
    .orderBy(
      sql`${leadContact.role} = 'requester' desc`,
      asc(leadContact.addedAt),
      asc(contact.id),
    )
  for (const { leadId, ...person } of rows) people.get(leadId)?.push(person)
  return people
}

async function lockedLead(
  tx: tTransaction,
  organizationId: string,
  leadId: string,
) {
  const [found] = await tx
    .select()
    .from(lead)
    .where(and(eq(lead.id, leadId), eq(lead.organizationId, organizationId)))
    .limit(1)
    .for('update')
  if (!found) throw new ApiError(404, 'lead_missing', 'Lead not found')
  return found
}

async function contactOnLead(
  tx: tTransaction,
  leadId: string,
  contactId: string,
) {
  const [found] = await tx
    .select({
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      role: leadContact.role,
    })
    .from(leadContact)
    .innerJoin(contact, eq(contact.id, leadContact.contactId))
    .where(
      and(eq(leadContact.leadId, leadId), eq(leadContact.contactId, contactId)),
    )
    .limit(1)
  if (!found)
    throw new ApiError(
      404,
      'lead_contact_missing',
      'Contact is not on this lead',
    )
  return found
}

const requesterFixed = () =>
  new ApiError(
    422,
    'requester_fixed',
    'The person who made the request stays on the lead',
  )

export async function addLeadContact(
  organizationId: string,
  leadId: string,
  input: { contactId: string; role: tLeadContactRole },
  actorMemberId: string,
) {
  return db.transaction(async (tx) => {
    await lockedLead(tx, organizationId, leadId)
    const [person] = await tx
      .select()
      .from(contact)
      .where(
        and(
          eq(contact.id, input.contactId),
          eq(contact.organizationId, organizationId),
        ),
      )
      .limit(1)
    if (!person)
      throw new ApiError(
        422,
        'invalid_contact',
        'Contact is not in this organization',
      )
    const [added] = await tx
      .insert(leadContact)
      .values({ leadId, contactId: person.id, role: input.role })
      .onConflictDoNothing()
      .returning()
    if (!added)
      throw new ApiError(
        409,
        'contact_on_lead',
        'Contact is already on this lead',
      )
    await writeActivity(tx, {
      organizationId,
      leadId,
      kind: 'contact_added',
      title: `Added ${displayName(person)} as ${roleLabel(input.role)}`,
      detail: { contactId: person.id, role: input.role },
      actorMemberId,
    })
    return (await leadContactsOf(tx, [leadId])).get(leadId)!
  })
}

export async function updateLeadContactRole(
  organizationId: string,
  leadId: string,
  contactId: string,
  role: tLeadContactRole,
  actorMemberId: string,
) {
  return db.transaction(async (tx) => {
    const record = await lockedLead(tx, organizationId, leadId)
    if (record.contactId === contactId) throw requesterFixed()
    const current = await contactOnLead(tx, leadId, contactId)
    if (current.role !== role) {
      await tx
        .update(leadContact)
        .set({ role })
        .where(
          and(
            eq(leadContact.leadId, leadId),
            eq(leadContact.contactId, contactId),
          ),
        )
      await writeActivity(tx, {
        organizationId,
        leadId,
        kind: 'contact_role_changed',
        title: `${displayName(current)} is now ${roleLabel(role)}`,
        detail: { contactId, from: current.role, to: role },
        actorMemberId,
      })
    }
    return (await leadContactsOf(tx, [leadId])).get(leadId)!
  })
}

export async function removeLeadContact(
  organizationId: string,
  leadId: string,
  contactId: string,
  actorMemberId: string,
) {
  await db.transaction(async (tx) => {
    const record = await lockedLead(tx, organizationId, leadId)
    if (record.contactId === contactId) throw requesterFixed()
    const current = await contactOnLead(tx, leadId, contactId)
    await tx
      .delete(leadContact)
      .where(
        and(
          eq(leadContact.leadId, leadId),
          eq(leadContact.contactId, contactId),
        ),
      )
    await writeActivity(tx, {
      organizationId,
      leadId,
      kind: 'contact_removed',
      title: `Removed ${displayName(current)}`,
      detail: { contactId, role: current.role },
      actorMemberId,
    })
  })
}

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  contact,
  contactFact,
  contactIdentity,
  conversation,
  lead,
  leadContact,
} from '../../db/schema'
import {
  leadContactRoles,
  type tLeadContactRole,
} from '../../db/schema/product/leadContact'
import { writeActivity } from '../leads/activity'
import { ApiError } from '../http/apiError'
import { contactDetail } from './contacts'
import { lockIdentities } from './identities'

// Lower is stronger.
const strength = (role: tLeadContactRole) => leadContactRoles.indexOf(role)

// Folds the source contact into the target: identities, deals, conversations
// and facts move, blank name is filled, and the
// source is deleted. Returns the target's detail.
export async function mergeContacts(
  organizationId: string,
  targetId: string,
  sourceId: string,
  actorMemberId: string,
) {
  if (targetId === sourceId)
    throw new ApiError(
      422,
      'invalid_merge',
      'A contact cannot merge into itself',
    )
  await db.transaction(async (tx) => {
    for (const id of [targetId, sourceId].sort())
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`contact:${id}`}))`,
      )
    // Capture can't link a source identity while it moves.
    await lockIdentities(
      tx,
      organizationId,
      await tx
        .select()
        .from(contactIdentity)
        .where(eq(contactIdentity.contactId, sourceId)),
    )
    const people = await tx
      .select()
      .from(contact)
      .where(
        and(
          eq(contact.organizationId, organizationId),
          inArray(contact.id, [targetId, sourceId]),
        ),
      )
      .orderBy(contact.id)
      .for('update')
    const target = people.find((item) => item.id === targetId)
    const source = people.find((item) => item.id === sourceId)
    if (!target || !source)
      throw new ApiError(404, 'contact_missing', 'Contact not found')

    const requested = await tx
      .update(lead)
      .set({ contactId: targetId })
      .where(eq(lead.contactId, sourceId))
      .returning({ id: lead.id })
    const sourceLinks = await tx
      .select()
      .from(leadContact)
      .where(eq(leadContact.contactId, sourceId))
    const targetLinks = sourceLinks.length
      ? await tx
          .select()
          .from(leadContact)
          .where(
            and(
              eq(leadContact.contactId, targetId),
              inArray(
                leadContact.leadId,
                sourceLinks.map((link) => link.leadId),
              ),
            ),
          )
      : []
    // A deal the source requested is now the target's request.
    for (const { id } of requested)
      await tx
        .insert(leadContact)
        .values({ leadId: id, contactId: targetId, role: 'requester' })
        .onConflictDoUpdate({
          target: [leadContact.leadId, leadContact.contactId],
          set: { role: 'requester' },
        })
    const requestedIds = new Set(requested.map((item) => item.id))
    for (const link of sourceLinks) {
      if (requestedIds.has(link.leadId)) continue
      const existing = targetLinks.find((item) => item.leadId === link.leadId)
      if (!existing)
        await tx
          .update(leadContact)
          .set({ contactId: targetId })
          .where(
            and(
              eq(leadContact.leadId, link.leadId),
              eq(leadContact.contactId, sourceId),
            ),
          )
      else if (strength(link.role) < strength(existing.role))
        await tx
          .update(leadContact)
          .set({ role: link.role })
          .where(
            and(
              eq(leadContact.leadId, link.leadId),
              eq(leadContact.contactId, targetId),
            ),
          )
    }

    await tx
      .update(contactIdentity)
      .set({ contactId: targetId, source: 'merge' })
      .where(eq(contactIdentity.contactId, sourceId))
    await tx
      .update(conversation)
      .set({ contactId: targetId })
      .where(eq(conversation.contactId, sourceId))
    await tx
      .update(contactFact)
      .set({ contactId: targetId })
      .where(eq(contactFact.contactId, sourceId))
    // Its leftover deal rows (where the target had a role) go with it.
    await tx.delete(contact).where(eq(contact.id, sourceId))
    await tx
      .update(contact)
      .set({
        name: target.name || source.name,
        ...(target.normalizedEmail
          ? {}
          : { email: source.email, normalizedEmail: source.normalizedEmail }),
        ...(target.normalizedPhone
          ? {}
          : { phone: source.phone, normalizedPhone: source.normalizedPhone }),
      })
      .where(eq(contact.id, targetId))

    const moved = new Set([
      ...requestedIds,
      ...sourceLinks.map((link) => link.leadId),
    ])
    const sourceName =
      source.name || source.email || source.phone || 'a contact'
    for (const leadId of moved)
      await writeActivity(tx, {
        organizationId,
        leadId,
        kind: 'contacts_merged',
        title: `Merged ${sourceName} into ${target.name || source.name || 'this contact'}`,
        detail: { sourceContactId: sourceId, targetContactId: targetId },
        actorMemberId,
      })
  })
  return contactDetail(db, organizationId, targetId)
}

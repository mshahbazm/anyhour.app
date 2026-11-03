import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { contact } from '../../db/schema'
import { ApiError } from '../http/apiError'
import {
  lockIdentities,
  matchingIdentities,
  normalizeEmail,
  normalizePhone,
  recordIdentity,
} from './identities'

// Adds a contact by hand. Their email and phone become identities (source
// manual); one that already belongs to someone is a 409 naming them, so the
// client can open that contact instead.
export async function createContact(
  organizationId: string,
  input: {
    name?: string | null
    email?: string | null
    phone?: string | null
  },
) {
  const email = input.email?.trim() ? normalizeEmail(input.email) : null
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : null
  const details = [
    email && {
      kind: 'email' as const,
      value: input.email!.trim(),
      normalizedValue: email,
    },
    phone && {
      kind: 'phone' as const,
      value: input.phone!.trim(),
      normalizedValue: phone,
    },
  ].filter((detail) => !!detail)
  if (!details.length)
    throw new ApiError(422, 'contact_required', 'Email or phone is required')
  return db.transaction(async (tx) => {
    await lockIdentities(tx, organizationId, details)
    const [owner] = await matchingIdentities(tx, organizationId, details)
    if (owner) {
      const [person] = await tx
        .select({ name: contact.name })
        .from(contact)
        .where(eq(contact.id, owner.contactId))
      throw new ApiError(
        409,
        'identity_taken',
        'Another contact already has this',
        { contactId: owner.contactId, contactName: person?.name ?? null },
      )
    }
    const [created] = await tx
      .insert(contact)
      .values({
        organizationId,
        name: input.name?.trim() || null,
        email: email ? input.email!.trim() : null,
        normalizedEmail: email,
        phone: phone ? input.phone!.trim() : null,
        normalizedPhone: phone,
      })
      .returning()
    for (const detail of details)
      await recordIdentity(tx, {
        organizationId,
        contactId: created.id,
        ...detail,
        source: 'manual',
      })
    return created
  })
}

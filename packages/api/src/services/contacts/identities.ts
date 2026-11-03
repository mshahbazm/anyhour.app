import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import { db } from '../../db'
import { contact, contactIdentity } from '../../db/schema'
import type {
  tContactIdentityKind,
  tContactIdentitySource,
} from '../../db/schema/product/contactIdentity'
import { ApiError } from '../http/apiError'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Phone and WhatsApp numbers are the same number: either kind links the
// contact that already has it.
const sameNumberKinds = ['phone', 'whatsapp'] as const

export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new ApiError(422, 'invalid_email', 'Email address is invalid')
  return email
}

export function normalizePhone(value: string) {
  const phone = value.replace(/[\s().-]/g, '')
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new ApiError(
      422,
      'invalid_phone',
      'Phone must use international format',
    )
  return phone
}

export function normalizeIdentity(kind: tContactIdentityKind, value: string) {
  return kind === 'email' ? normalizeEmail(value) : normalizePhone(value)
}

// The kinds a normalized value can clash with.
const clashingKinds = (kind: tContactIdentityKind) =>
  kind === 'email' ? (['email'] as const) : sameNumberKinds

// Capture, adding an identity and merging take these per value, in sorted
// order, before reading who owns it.
export async function lockIdentities(
  tx: tTransaction,
  organizationId: string,
  identities: Array<{ kind: tContactIdentityKind; normalizedValue: string }>,
) {
  const keys = [
    ...new Set(
      identities.map(
        (item) =>
          `${item.kind === 'email' ? 'email' : 'phone'}:${organizationId}:${item.normalizedValue}`,
      ),
    ),
  ].sort()
  for (const key of keys)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`)
}

// Identities matching any of the values, across clashing kinds.
export function matchingIdentities(
  tx: tTransaction,
  organizationId: string,
  identities: Array<{ kind: tContactIdentityKind; normalizedValue: string }>,
) {
  return tx
    .select()
    .from(contactIdentity)
    .where(
      and(
        eq(contactIdentity.organizationId, organizationId),
        or(
          ...identities.map((item) =>
            and(
              inArray(contactIdentity.kind, [...clashingKinds(item.kind)]),
              eq(contactIdentity.normalizedValue, item.normalizedValue),
            ),
          ),
        ),
      ),
    )
}

// Records an identity for a contact unless it already has it. The caller holds
// the value's lock and has checked no other contact owns it.
export async function recordIdentity(
  tx: tTransaction,
  input: {
    organizationId: string
    contactId: string
    kind: tContactIdentityKind
    value: string
    normalizedValue: string
    source: tContactIdentitySource
  },
) {
  const [created] = await tx
    .insert(contactIdentity)
    .values({ ...input, value: input.value.trim() })
    .onConflictDoNothing()
    .returning()
  return created ?? null
}

async function lockedContact(
  tx: tTransaction,
  organizationId: string,
  contactId: string,
) {
  const [found] = await tx
    .select()
    .from(contact)
    .where(
      and(
        eq(contact.id, contactId),
        eq(contact.organizationId, organizationId),
      ),
    )
    .limit(1)
    .for('update')
  if (!found) throw new ApiError(404, 'contact_missing', 'Contact not found')
  return found
}

// Adds a way of reaching a contact by hand. Another contact owning it is a 409
// naming that contact, so the client can offer a merge.
export async function addIdentity(
  organizationId: string,
  contactId: string,
  input: { kind: tContactIdentityKind; value: string },
) {
  const normalizedValue = normalizeIdentity(input.kind, input.value)
  return db.transaction(async (tx) => {
    await lockIdentities(tx, organizationId, [
      { kind: input.kind, normalizedValue },
    ])
    const person = await lockedContact(tx, organizationId, contactId)
    const owners = await matchingIdentities(tx, organizationId, [
      { kind: input.kind, normalizedValue },
    ])
    const other = owners.find((item) => item.contactId !== contactId)
    if (other) {
      const [owner] = await tx
        .select({ name: contact.name })
        .from(contact)
        .where(eq(contact.id, other.contactId))
      throw new ApiError(
        409,
        'identity_taken',
        'Another contact already has this',
        { contactId: other.contactId, contactName: owner?.name ?? null },
      )
    }
    const existing = owners.find((item) => item.kind === input.kind)
    if (existing) return { identity: existing, created: false }
    const identity = (await recordIdentity(tx, {
      organizationId,
      contactId,
      kind: input.kind,
      value: input.value,
      normalizedValue,
      source: 'manual',
    }))!
    // A contact without a display value of this kind shows the new one.
    if (input.kind === 'email' && !person.normalizedEmail)
      await tx
        .update(contact)
        .set({ email: identity.value, normalizedEmail: normalizedValue })
        .where(eq(contact.id, contactId))
    if (input.kind === 'phone' && !person.normalizedPhone)
      await tx
        .update(contact)
        .set({ phone: identity.value, normalizedPhone: normalizedValue })
        .where(eq(contact.id, contactId))
    return { identity, created: true }
  })
}

// Removes one way of reaching a contact; the last one stays. The display email
// or phone moves to the next identity of that kind, or clears.
export async function removeIdentity(
  organizationId: string,
  contactId: string,
  identityId: string,
) {
  await db.transaction(async (tx) => {
    const person = await lockedContact(tx, organizationId, contactId)
    const identities = await tx
      .select()
      .from(contactIdentity)
      .where(eq(contactIdentity.contactId, contactId))
      .orderBy(asc(contactIdentity.createdAt), asc(contactIdentity.id))
    const removed = identities.find((item) => item.id === identityId)
    if (!removed)
      throw new ApiError(404, 'identity_missing', 'Identity not found')
    if (identities.length === 1)
      throw new ApiError(
        422,
        'last_identity',
        'A contact needs at least one way to reach them',
      )
    await tx
      .delete(contactIdentity)
      .where(
        and(
          eq(contactIdentity.id, identityId),
          eq(contactIdentity.contactId, contactId),
        ),
      )
    const next = identities.find(
      (item) => item.kind === removed.kind && item.id !== removed.id,
    )
    if (
      removed.kind === 'email' &&
      person.normalizedEmail === removed.normalizedValue
    )
      await tx
        .update(contact)
        .set({
          email: next?.value ?? null,
          normalizedEmail: next?.normalizedValue ?? null,
        })
        .where(eq(contact.id, contactId))
    if (
      removed.kind === 'phone' &&
      person.normalizedPhone === removed.normalizedValue
    )
      await tx
        .update(contact)
        .set({
          phone: next?.value ?? null,
          normalizedPhone: next?.normalizedValue ?? null,
        })
        .where(eq(contact.id, contactId))
  })
}

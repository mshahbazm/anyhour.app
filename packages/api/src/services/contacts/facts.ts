import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { contactFact } from '../../db/schema'
import { ApiError } from '../http/apiError'
import { ownedContact } from './contacts'

// What the business remembers about a contact, newest first. Owner-facing only.
export async function listFacts(organizationId: string, contactId: string) {
  await ownedContact(db, organizationId, contactId)
  return db
    .select()
    .from(contactFact)
    .where(eq(contactFact.contactId, contactId))
    .orderBy(desc(contactFact.createdAt), desc(contactFact.id))
}

export async function addFact(
  organizationId: string,
  contactId: string,
  text: string,
  memberId: string,
) {
  await ownedContact(db, organizationId, contactId)
  const [fact] = await db
    .insert(contactFact)
    .values({
      organizationId,
      contactId,
      text,
      source: 'member',
      createdByMemberId: memberId,
    })
    .returning()
  return fact
}

const factOf = (organizationId: string, contactId: string, factId: string) =>
  and(
    eq(contactFact.id, factId),
    eq(contactFact.contactId, contactId),
    eq(contactFact.organizationId, organizationId),
  )

export async function updateFact(
  organizationId: string,
  contactId: string,
  factId: string,
  text: string,
) {
  const [fact] = await db
    .update(contactFact)
    .set({ text })
    .where(factOf(organizationId, contactId, factId))
    .returning()
  if (!fact) throw new ApiError(404, 'fact_missing', 'Fact not found')
  return fact
}

export async function deleteFact(
  organizationId: string,
  contactId: string,
  factId: string,
) {
  const [fact] = await db
    .delete(contactFact)
    .where(factOf(organizationId, contactId, factId))
    .returning({ id: contactFact.id })
  if (!fact) throw new ApiError(404, 'fact_missing', 'Fact not found')
}

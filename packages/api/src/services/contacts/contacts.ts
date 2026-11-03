import {
  and,
  asc,
  desc,
  type Column,
  eq,
  exists,
  getTableName,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { db } from '../../db'
import {
  assistant,
  contact,
  contactFact,
  contactIdentity,
  conversation,
  lead,
  leadActivity,
  leadContact,
  message,
} from '../../db/schema'
import { ApiError } from '../http/apiError'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type tDatabase = typeof db | tTransaction

// A search term for ILIKE, matched literally anywhere in the value.
export function likePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`
}

export async function ownedContact(
  database: tDatabase,
  organizationId: string,
  contactId: string,
) {
  const [found] = await database
    .select()
    .from(contact)
    .where(
      and(
        eq(contact.id, contactId),
        eq(contact.organizationId, organizationId),
      ),
    )
    .limit(1)
  if (!found) throw new ApiError(404, 'contact_missing', 'Contact not found')
  return found
}

// The contact list's filter: the workspace and a search over name,
// display values and every identity.
export function contactScope(
  organizationId: string,
  options: { q?: string },
): SQL {
  const pattern = options.q?.trim() ? likePattern(options.q.trim()) : null
  return and(
    eq(contact.organizationId, organizationId),
    pattern
      ? or(
          ilike(contact.name, pattern),
          ilike(contact.email, pattern),
          ilike(contact.phone, pattern),
          exists(
            db
              .select({ one: sql`1` })
              .from(contactIdentity)
              .where(
                and(
                  eq(contactIdentity.contactId, contact.id),
                  or(
                    ilike(contactIdentity.value, pattern),
                    ilike(contactIdentity.normalizedValue, pattern),
                  ),
                ),
              ),
          ),
        )
      : undefined,
  )!
}

// One page of contacts with their open deals, ways to reach them and
// when anything last happened.
export function listContacts(where: SQL, limit: number) {
  // A select from one table renders its columns without the table name, so
  // the subqueries name theirs in full.
  const q = (column: Column) =>
    sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`
  const openDealCount = sql<number>`(
    select count(*)::int from ${leadContact}
    join ${lead} on ${q(lead.id)} = ${q(leadContact.leadId)}
    where ${q(leadContact.contactId)} = ${q(contact.id)}
      and ${q(lead.mergedIntoLeadId)} is null and ${q(lead.closedAt)} is null
  )`
  const identityKinds = sql<string[]>`array(
    select distinct ${q(contactIdentity.kind)} from ${contactIdentity}
    where ${q(contactIdentity.contactId)} = ${q(contact.id)}
    order by 1
  )`
  const lastActivityAt = sql`greatest(
    (select max(${q(leadActivity.createdAt)}) from ${leadActivity}
      join ${leadContact} on ${q(leadContact.leadId)} = ${q(leadActivity.leadId)}
      where ${q(leadContact.contactId)} = ${q(contact.id)}),
    (select max(${q(conversation.lastMessageAt)}) from ${conversation}
      where ${q(conversation.contactId)} = ${q(contact.id)} and not ${q(conversation.isTest)})
  )`.mapWith(leadActivity.createdAt)
  return db
    .select({
      id: contact.id,
      organizationId: contact.organizationId,
      name: contact.name,
      email: contact.email,
      normalizedEmail: contact.normalizedEmail,
      phone: contact.phone,
      normalizedPhone: contact.normalizedPhone,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
      openDealCount,
      identityKinds,
      lastActivityAt,
    })
    .from(contact)
    .where(where)
    .orderBy(desc(contact.createdAt), desc(contact.id))
    .limit(limit)
}

// The unmerged deals the contacts are on, newest first, with each one's role.
export async function contactDeals(database: tDatabase, contactIds: string[]) {
  if (!contactIds.length) return []
  const rows = await database
    .select({
      contactId: leadContact.contactId,
      role: leadContact.role,
      id: lead.id,
      title: lead.title,
      closedAt: lead.closedAt,
      createdAt: lead.createdAt,
      status: lead.status,
    })
    .from(leadContact)
    .innerJoin(lead, eq(lead.id, leadContact.leadId))
    .where(
      and(
        inArray(leadContact.contactId, contactIds),
        isNull(lead.mergedIntoLeadId),
      ),
    )
    .orderBy(desc(lead.createdAt), desc(lead.id))
  return rows.map((row) => ({
    contactId: row.contactId,
    deal: {
      id: row.id,
      title: row.title,
      role: row.role,
      isOpen: row.closedAt === null,
      closedAt: row.closedAt,
      createdAt: row.createdAt,
      status: row.status,
    },
  }))
}

// Everything the contact page shows: identities, memory, deals,
// conversations and the latest activity across its deals.
export async function contactDetail(
  database: tDatabase,
  organizationId: string,
  contactId: string,
) {
  const person = await ownedContact(database, organizationId, contactId)
  const [identities, facts, deals, chats] = await Promise.all([
    database
      .select()
      .from(contactIdentity)
      .where(eq(contactIdentity.contactId, contactId))
      .orderBy(asc(contactIdentity.createdAt), asc(contactIdentity.id)),
    database
      .select()
      .from(contactFact)
      .where(eq(contactFact.contactId, contactId))
      .orderBy(desc(contactFact.createdAt), desc(contactFact.id)),
    contactDeals(database, [contactId]),
    database
      .select({
        id: conversation.id,
        assistantId: conversation.assistantId,
        assistantName: assistant.name,
        status: conversation.status,
        createdAt: conversation.createdAt,
        lastMessageAt: conversation.lastMessageAt,
      })
      .from(conversation)
      .innerJoin(assistant, eq(assistant.id, conversation.assistantId))
      .where(
        and(
          eq(conversation.contactId, contactId),
          eq(assistant.organizationId, organizationId),
          eq(conversation.isTest, false),
        ),
      )
      .orderBy(
        sql`${conversation.lastMessageAt} desc nulls last`,
        desc(conversation.createdAt),
      )
      .limit(50),
  ])
  const lastMessages = chats.length
    ? await database
        .selectDistinctOn([message.conversationId], {
          conversationId: message.conversationId,
          role: message.role,
          content: sql<string>`left(${message.content}, 200)`,
          createdAt: message.createdAt,
        })
        .from(message)
        .where(
          and(
            inArray(
              message.conversationId,
              chats.map((item) => item.id),
            ),
            ne(message.role, 'tool'),
          ),
        )
        .orderBy(message.conversationId, desc(message.createdAt))
    : []
  const leadIds = deals.map((item) => item.deal.id)
  const activities = leadIds.length
    ? await database
        .select({
          id: leadActivity.id,
          kind: leadActivity.kind,
          title: leadActivity.title,
          detail: leadActivity.detail,
          actorMemberId: leadActivity.actorMemberId,
          createdAt: leadActivity.createdAt,
          leadId: leadActivity.leadId,
          leadTitle: lead.title,
        })
        .from(leadActivity)
        .innerJoin(lead, eq(lead.id, leadActivity.leadId))
        .where(inArray(leadActivity.leadId, leadIds))
        .orderBy(desc(leadActivity.createdAt), desc(leadActivity.id))
        .limit(20)
    : []
  return {
    contact: person,
    identities,
    facts,
    deals: deals.map((item) => item.deal),
    conversations: chats.map((chat) => {
      const last = lastMessages.find((item) => item.conversationId === chat.id)
      return {
        ...chat,
        lastMessage: last
          ? {
              role: last.role,
              content: last.content,
              createdAt: last.createdAt,
            }
          : null,
      }
    }),
    activities,
  }
}

export async function updateContact(
  organizationId: string,
  contactId: string,
  input: { name?: string | null },
) {
  await ownedContact(db, organizationId, contactId)
  const [updated] = await db
    .update(contact)
    .set({
      ...(input.name !== undefined ? { name: input.name?.trim() || null } : {}),
    })
    .where(
      and(
        eq(contact.id, contactId),
        eq(contact.organizationId, organizationId),
      ),
    )
    .returning()
  if (!updated) throw new ApiError(404, 'contact_missing', 'Contact not found')
  return updated
}

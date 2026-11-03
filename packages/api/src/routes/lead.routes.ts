import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
} from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db'
import { contact, lead, leadConversation, leadNote, member } from '../db/schema'
import { leadStatuses, openLeadStatuses } from '../db/schema/product/lead'
import {
  addLeadContactSchema,
  addNoteSchema,
  mergeLeadSchema,
  updateLeadContactSchema,
  updateLeadSchema,
} from '../schemas/lead.schema'
import { requirePermission } from '../services/auth/authorize'
import { ApiError } from '../services/http/apiError'
import { leadActivityPage } from '../services/leads/activity'
import { setLeadStatus } from '../services/leads/setStatus'
import { validateJson } from '../services/http/validateJson'
import {
  addLeadContact,
  leadContactsOf,
  removeLeadContact,
  updateLeadContactRole,
} from '../services/leads/leadContacts'
import { readPage, pageResponse } from '../services/http/pagination'

export const leadRoutes = new Hono()

leadRoutes.get('/:organizationId/leads', async (c) => {
  const organizationId = c.req.param('organizationId')
  await requirePermission(c.req.raw.headers, organizationId, 'lead', 'read')
  // A status, or `open` for new and contacted; all leads when absent.
  const statusQuery = c.req.query('status')
  const statuses =
    statusQuery === 'open'
      ? openLeadStatuses
      : leadStatuses.filter((item) => item === statusQuery)
  if (statusQuery && !statuses.length)
    throw new ApiError(422, 'invalid_status', 'Unknown lead status')
  const page = await readPage(
    c,
    lead,
    lead.id,
    lead.createdAt,
    and(
      eq(lead.organizationId, organizationId),
      isNull(lead.mergedIntoLeadId),
      statusQuery ? inArray(lead.status, [...statuses]) : undefined,
    )!,
  )
  const rows = await db
    .select({
      ...getTableColumns(lead),
      contactName: contact.name,
      contactEmail: contact.email,
      contactPhone: contact.phone,
    })
    .from(lead)
    .innerJoin(contact, eq(contact.id, lead.contactId))
    .where(page.where)
    .orderBy(desc(lead.createdAt), desc(lead.id))
    .limit(page.limit + 1)
  const people = await leadContactsOf(
    db,
    rows.slice(0, page.limit).map((row) => row.id),
  )
  return pageResponse(
    c,
    rows.map((row) => ({
      ...row,
      contacts: people.get(row.id) ?? [],
    })),
    page.limit,
  )
})

leadRoutes.get('/:organizationId/leads/:leadId', async (c) => {
  const { organizationId, leadId } = c.req.param()
  await requirePermission(c.req.raw.headers, organizationId, 'lead', 'read')
  const [record] = await db
    .select()
    .from(lead)
    .where(and(eq(lead.id, leadId), eq(lead.organizationId, organizationId)))
    .limit(1)
  if (!record) throw new ApiError(404, 'lead_missing', 'Lead not found')
  const [person] = await db
    .select()
    .from(contact)
    .where(eq(contact.id, record.contactId))
    .limit(1)
  const notes = await db
    .select()
    .from(leadNote)
    .where(eq(leadNote.leadId, leadId))
    .orderBy(asc(leadNote.createdAt))
  const conversations = await db
    .select()
    .from(leadConversation)
    .where(eq(leadConversation.leadId, leadId))
  return c.json({
    lead: record,
    contact: person,
    contacts: (await leadContactsOf(db, [leadId])).get(leadId) ?? [],
    notes,
    conversationIds: conversations.map((item) => item.conversationId),
  })
})

leadRoutes.get('/:organizationId/leads/:leadId/activity', async (c) => {
  const { organizationId, leadId } = c.req.param()
  await requirePermission(c.req.raw.headers, organizationId, 'lead', 'read')
  return c.json(
    await leadActivityPage(organizationId, leadId, c.req.query('before')),
  )
})

leadRoutes.patch(
  '/:organizationId/leads/:leadId',
  validateJson(updateLeadSchema),
  async (c) => {
    const { organizationId, leadId } = c.req.param()
    const { membership } = await requirePermission(
      c.req.raw.headers,
      organizationId,
      'lead',
      'update',
    )
    const input = c.req.valid('json')
    if (input.assignedMemberId) {
      const [assignee] = await db
        .select()
        .from(member)
        .where(
          and(
            eq(member.id, input.assignedMemberId),
            eq(member.organizationId, organizationId),
          ),
        )
        .limit(1)
      if (!assignee)
        throw new ApiError(
          422,
          'invalid_assignee',
          'Assignee is not in this organization',
        )
    }
    const { status, ...fields } = input
    const result = await db.transaction(async (tx) => {
      const statusSet = status
        ? await setLeadStatus(tx, {
            organizationId,
            leadId,
            status,
            actorMemberId: membership.id,
          })
        : null
      if (statusSet && !statusSet.lead) return null
      const [current] = await tx
        .select()
        .from(lead)
        .where(
          and(eq(lead.id, leadId), eq(lead.organizationId, organizationId)),
        )
        .limit(1)
        .for('update')
      if (!current) return null
      // Only fields whose value actually changes are written.
      const changes = (
        Object.keys(fields) as Array<keyof typeof fields>
      ).filter((key) => fields[key] !== current[key])
      const changed = changes.length
        ? (
            await tx
              .update(lead)
              .set(Object.fromEntries(changes.map((key) => [key, fields[key]])))
              .where(eq(lead.id, current.id))
              .returning()
          ).at(0)
        : current
      if (!changed) return null
      return changed
    })
    if (!result) throw new ApiError(404, 'lead_missing', 'Lead not found')
    return c.json(result)
  },
)

leadRoutes.post(
  '/:organizationId/leads/:leadId/notes',
  validateJson(addNoteSchema),
  async (c) => {
    const { organizationId, leadId } = c.req.param()
    const { membership } = await requirePermission(
      c.req.raw.headers,
      organizationId,
      'lead',
      'update',
    )
    const [record] = await db
      .select()
      .from(lead)
      .where(and(eq(lead.id, leadId), eq(lead.organizationId, organizationId)))
      .limit(1)
    if (!record) throw new ApiError(404, 'lead_missing', 'Lead not found')
    const [note] = await db
      .insert(leadNote)
      .values({
        leadId,
        authorMemberId: membership.id,
        body: c.req.valid('json').body,
      })
      .returning()
    return c.json(note, 201)
  },
)

leadRoutes.post(
  '/:organizationId/leads/:leadId/merge',
  validateJson(mergeLeadSchema),
  async (c) => {
    const { organizationId, leadId } = c.req.param()
    await requirePermission(c.req.raw.headers, organizationId, 'lead', 'update')
    const targetId = c.req.valid('json').targetLeadId
    if (leadId === targetId)
      throw new ApiError(
        422,
        'invalid_merge',
        'A lead cannot merge into itself',
      )
    const merged = await db.transaction(async (tx) => {
      const records = await tx
        .select()
        .from(lead)
        .where(
          and(
            eq(lead.organizationId, organizationId),
            inArray(lead.id, [leadId, targetId]),
          ),
        )
      const source = records.find((item) => item.id === leadId)
      const target = records.find((item) => item.id === targetId)
      if (!source || !target)
        throw new ApiError(404, 'lead_missing', 'Lead not found')
      if (
        source.contactId !== target.contactId ||
        source.mergedIntoLeadId ||
        target.mergedIntoLeadId
      )
        throw new ApiError(409, 'invalid_merge', 'These leads cannot be merged')
      const links = await tx
        .select()
        .from(leadConversation)
        .where(eq(leadConversation.leadId, source.id))
      for (const link of links)
        await tx
          .insert(leadConversation)
          .values({ leadId: target.id, conversationId: link.conversationId })
          .onConflictDoNothing()
      await tx
        .update(leadNote)
        .set({ leadId: target.id })
        .where(eq(leadNote.leadId, source.id))
      const [result] = await tx
        .update(lead)
        .set({
          mergedIntoLeadId: target.id,
          closedAt: new Date(),
        })
        .where(eq(lead.id, source.id))
        .returning()
      return result
    })
    return c.json(merged)
  },
)

leadRoutes.post(
  '/:organizationId/leads/:leadId/contacts',
  validateJson(addLeadContactSchema),
  async (c) => {
    const { organizationId, leadId } = c.req.param()
    const { membership } = await requirePermission(
      c.req.raw.headers,
      organizationId,
      'lead',
      'update',
    )
    return c.json(
      await addLeadContact(
        organizationId,
        leadId,
        c.req.valid('json'),
        membership.id,
      ),
      201,
    )
  },
)

leadRoutes.patch(
  '/:organizationId/leads/:leadId/contacts/:contactId',
  validateJson(updateLeadContactSchema),
  async (c) => {
    const { organizationId, leadId, contactId } = c.req.param()
    const { membership } = await requirePermission(
      c.req.raw.headers,
      organizationId,
      'lead',
      'update',
    )
    return c.json(
      await updateLeadContactRole(
        organizationId,
        leadId,
        contactId,
        c.req.valid('json').role,
        membership.id,
      ),
    )
  },
)

leadRoutes.delete(
  '/:organizationId/leads/:leadId/contacts/:contactId',
  async (c) => {
    const { organizationId, leadId, contactId } = c.req.param()
    const { membership } = await requirePermission(
      c.req.raw.headers,
      organizationId,
      'lead',
      'update',
    )
    await removeLeadContact(organizationId, leadId, contactId, membership.id)
    return c.body(null, 204)
  },
)

import { and, desc, eq, lt } from 'drizzle-orm'
import { db } from '../../db'
import { lead, leadActivity } from '../../db/schema'
import type { tLeadActivityKind } from '../../db/schema/product/leadActivity'
import type { iLeadActivityList } from '../../types/lead.types'
import { ApiError } from '../http/apiError'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type tDatabase = typeof db | tTransaction

const activityPageSize = 50

// One entry on the lead's timeline.
export async function writeActivity(
  database: tDatabase,
  input: {
    organizationId: string
    leadId: string
    kind: tLeadActivityKind
    title: string
    detail?: Record<string, unknown> | null
    actorMemberId?: string | null
  },
) {
  await database.insert(leadActivity).values({
    organizationId: input.organizationId,
    leadId: input.leadId,
    kind: input.kind,
    title: input.title,
    detail: input.detail ?? null,
    actorMemberId: input.actorMemberId ?? null,
  })
}

// The lead's timeline, newest first, 50 at a time.
export async function leadActivityPage(
  organizationId: string,
  leadId: string,
  before?: string,
): Promise<iLeadActivityList> {
  const [found] = await db
    .select({ id: lead.id })
    .from(lead)
    .where(and(eq(lead.id, leadId), eq(lead.organizationId, organizationId)))
    .limit(1)
  if (!found) throw new ApiError(404, 'lead_missing', 'Lead not found')
  let cursor: Date | undefined
  if (before !== undefined) {
    cursor = new Date(before)
    if (Number.isNaN(cursor.getTime()))
      throw new ApiError(422, 'invalid_cursor', 'before must be an ISO time')
  }
  const rows = await db
    .select()
    .from(leadActivity)
    .where(
      and(
        eq(leadActivity.leadId, leadId),
        cursor ? lt(leadActivity.createdAt, cursor) : undefined,
      ),
    )
    .orderBy(desc(leadActivity.createdAt), desc(leadActivity.id))
    .limit(activityPageSize + 1)
  const page = rows.slice(0, activityPageSize)
  return {
    activities: page.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      detail: row.detail,
      actorMemberId: row.actorMemberId,
      createdAt: row.createdAt.toISOString(),
    })),
    nextBefore:
      rows.length > activityPageSize
        ? page[page.length - 1].createdAt.toISOString()
        : null,
  }
}

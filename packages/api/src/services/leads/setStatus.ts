import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { closedLeadStatuses, lead } from '../../db/schema/product/lead'
import type { tLeadStatus } from '../../db/schema/product/lead'
import { writeActivity } from './activity'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type tLeadRecord = typeof lead.$inferSelect

export interface iSetLeadStatusInput {
  organizationId: string
  leadId: string
  status: tLeadStatus
  actorMemberId?: string | null
}

export interface iSetLeadStatusResult {
  // Null when the lead isn't in this workspace.
  lead: tLeadRecord | null
  changed: boolean
}

// The one path for changing a lead's status, inside the caller's transaction.
// closedAt follows the status: set for won and lost, cleared otherwise, and
// the change goes on the lead's timeline.
export async function setLeadStatus(
  tx: tTransaction,
  input: iSetLeadStatusInput,
): Promise<iSetLeadStatusResult> {
  const [current] = await tx
    .select()
    .from(lead)
    .where(
      and(
        eq(lead.id, input.leadId),
        eq(lead.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for('update')
  if (!current) return { lead: null, changed: false }
  if (current.status === input.status) return { lead: current, changed: false }
  const [updated] = await tx
    .update(lead)
    .set({
      status: input.status,
      statusChangedAt: new Date(),
      closedAt: closedLeadStatuses.includes(input.status)
        ? (current.closedAt ?? new Date())
        : null,
    })
    .where(eq(lead.id, current.id))
    .returning()
  await writeActivity(tx, {
    organizationId: input.organizationId,
    leadId: current.id,
    kind: 'status_changed',
    title: `Marked as ${input.status}`,
    detail: { from: current.status, to: input.status },
    actorMemberId: input.actorMemberId,
  })
  return { lead: updated, changed: true }
}

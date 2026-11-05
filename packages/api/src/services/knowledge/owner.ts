import { eq } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db } from '../../db'
import { organization } from '../../db/schema'
import { ApiError } from '../http/apiError'
import {
  enqueueBusinessHours,
  enqueueContactDetails,
  enqueueOverviewRefresh,
} from '../queue/boss'
import { findWorkspaceAi } from '../assistants/workspaceAi'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Who a piece of knowledge belongs to: the workspace. It has one layer,
// Your business, which the workspace's AI reads.
export interface iKnowledgeOwner {
  organizationId: string
}

interface iOwnedTable {
  organizationId: AnyPgColumn
}

export const businessOwner = (organizationId: string): iKnowledgeOwner => ({
  organizationId,
})

export const ownerOf = (row: iKnowledgeOwner): iKnowledgeOwner => ({
  organizationId: row.organizationId,
})

/** Rows of this workspace's knowledge. */
export function ownedBy(table: iOwnedTable, owner: iKnowledgeOwner) {
  return eq(table.organizationId, owner.organizationId)
}

// Source changes and run requests take the workspace row lock, so deletion
// can't pass the active-run check while another request creates a run.
export async function lockOwner(tx: tTransaction, owner: iKnowledgeOwner) {
  const [row] = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, owner.organizationId))
    .for('update')
  if (!row) throw new ApiError(404, 'workspace_missing', 'Workspace not found')
}

// The AI's overview covers Your business, so a change refreshes it; an
// unchanged input skips the model call. The opening hours and contact
// details are read again too.
export async function knowledgeChanged(owner: iKnowledgeOwner) {
  const ai = await findWorkspaceAi(owner.organizationId)
  if (ai) await enqueueOverviewRefresh(ai.id).catch(() => undefined)
  await enqueueBusinessHours(owner.organizationId).catch(() => undefined)
  await enqueueContactDetails(owner.organizationId).catch(() => undefined)
}

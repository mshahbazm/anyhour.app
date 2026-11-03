import { asc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { assistant } from '../../db/schema'
import { ApiError } from '../http/apiError'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// A workspace has one AI (docs/focusedProduct.md, "One AI per business"),
// made at sign-up. This is the only place that decides which `assistant`
// row it is: the oldest, so a workspace with leftover rows still has one.

/** The workspace's AI, or null before sign-up made it. */
export async function findWorkspaceAi(
  organizationId: string,
  tx: typeof db | tTransaction = db,
) {
  const [row] = await tx
    .select()
    .from(assistant)
    .where(eq(assistant.organizationId, organizationId))
    .orderBy(asc(assistant.createdAt), asc(assistant.id))
    .limit(1)
  return row ?? null
}

/** The workspace's AI; 404 when the workspace has none yet. */
export async function workspaceAi(organizationId: string) {
  const row = await findWorkspaceAi(organizationId)
  if (!row)
    throw new ApiError(404, 'assistant_missing', 'Your AI isn’t set up yet')
  return row
}

import { and, eq, inArray, isNull, lte } from 'drizzle-orm'
import { db } from '../../db'
import { assistant, knowledgeSource } from '../../db/schema'
import { businessOwner, lockOwner, ownedBy } from './owner'
import { createRunRequest, dispatchRunRequest } from './runRequests'

// A due AI re-reads what it knows, Your business; an active run is reused
// and unchanged pages are cheap to check.
export async function refreshAssistantIfDue(
  assistantId: string,
  now = new Date(),
) {
  const [bot] = await db
    .select({ organizationId: assistant.organizationId })
    .from(assistant)
    .where(eq(assistant.id, assistantId))
  if (!bot) return []
  const business = businessOwner(bot.organizationId)
  const runs = await db.transaction(async (tx) => {
    // Same order as adding a business source: the workspace, then the bot.
    await lockOwner(tx, business)
    const [owner] = await tx
      .select()
      .from(assistant)
      .where(
        and(
          eq(assistant.id, assistantId),
          eq(assistant.status, 'published'),
          lte(assistant.nextRefreshAt, now),
        ),
      )
      .for('update')
    if (!owner) return []
    const roots = await tx
      .select({ id: knowledgeSource.id })
      .from(knowledgeSource)
      .where(
        and(
          ownedBy(knowledgeSource, business),
          isNull(knowledgeSource.parentId),
          inArray(knowledgeSource.kind, [
            'website',
            'webPage',
            'publicDocument',
          ]),
          eq(knowledgeSource.isIncluded, true),
        ),
      )
    const requested = []
    for (const root of roots)
      requested.push(await createRunRequest(tx, business, root.id, 'scheduled'))
    // Moving the deadline and recording every intended run is one commit.
    // A process crash can delay dispatch, but cannot skip this refresh cycle.
    await tx
      .update(assistant)
      .set({
        nextRefreshAt: new Date(
          now.getTime() + (owner.refreshIntervalHours ?? 24) * 3_600_000,
        ),
      })
      .where(eq(assistant.id, owner.id))
    return requested
  })
  for (const run of runs) await dispatchRunRequest(run.id)
  return runs
}

export async function refreshDueSources() {
  const now = new Date()
  const due = await db
    .select({ id: assistant.id })
    .from(assistant)
    .where(
      and(eq(assistant.status, 'published'), lte(assistant.nextRefreshAt, now)),
    )
  for (const item of due) {
    try {
      await refreshAssistantIfDue(item.id, now)
    } catch (error) {
      // Transaction rollback retains the old deadline for a later cycle.
      console.error(
        'Scheduled refresh failed',
        error instanceof Error ? error.name : 'Unknown error',
      )
    }
  }
}

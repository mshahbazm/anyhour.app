import {
  and,
  eq,
  inArray,
  isNotNull,
  notExists,
  notLike,
  sql,
} from 'drizzle-orm'
import { db } from '../src/db'
import {
  assistant,
  conversation,
  indexRun,
  knowledgeSource,
  member,
  organization,
  user,
  whatsappAgent,
} from '../src/db/schema'
import { assertLocalTestEnvironment } from './localSeedSupport'

// Integration files share the local database and its pg-boss queues, and each
// starts its own worker against its own fake servers. Work an earlier file left
// behind would run in the next file's worker and call that file's fakes. The
// integration seed calls this before every file so each starts with no
// leftover work. Rows are only neutralised, never deleted, and only in test
// workspaces: those with no member other than the integration users. The
// manual dev workspace and real local workspaces are left alone.
export async function clearLeftoverIntegrationWork() {
  assertLocalTestEnvironment()
  const now = new Date()
  const testOrganizations = db
    .select({ id: organization.id })
    .from(organization)
    .where(
      notExists(
        db
          .select({ id: member.id })
          .from(member)
          .innerJoin(user, eq(user.id, member.userId))
          .where(
            and(
              eq(member.organizationId, organization.id),
              notLike(user.email, 'integration-%@anyhour.local'),
            ),
          ),
      ),
    )
  const testAssistants = db
    .select({ id: assistant.id })
    .from(assistant)
    .where(inArray(assistant.organizationId, testOrganizations))

  await db.transaction(async (tx) => {
    // Every job not yet finished (created, retry, active). pg-boss can't scope
    // by workspace, so this is the whole local queue; the dev worker must not
    // run during tests anyway (packages/api/AGENTS.md), and the rows its
    // sweeps would re-queue are below. The table is absent before pg-boss's
    // first start.
    const queue = await tx.execute<{ exists: boolean }>(
      sql`select to_regclass('pgboss.job') is not null as exists`,
    )
    if (queue.rows[0]?.exists)
      await tx.execute(sql`delete from pgboss.job where state <= 'active'`)

    // What the worker's startup recovery and minute loop would pick up again:
    // index runs still queued or running (recoverIndexRuns, at start)...
    await tx
      .update(indexRun)
      .set({
        status: 'failed',
        completedAt: now,
        errorSummary: 'Cleared before an integration test file',
      })
      .where(
        and(
          inArray(indexRun.status, ['queued', 'running']),
          inArray(indexRun.organizationId, testOrganizations),
        ),
      )
    // ...scheduled refreshes (refreshDueSources) and archive rechecks
    // (recoverArchiveRechecks)...
    await tx
      .update(assistant)
      .set({ nextRefreshAt: null })
      .where(
        and(
          isNotNull(assistant.nextRefreshAt),
          inArray(assistant.organizationId, testOrganizations),
        ),
      )
    await tx
      .update(knowledgeSource)
      .set({ nextArchiveCheckAt: null })
      .where(
        and(
          isNotNull(knowledgeSource.nextArchiveCheckAt),
          inArray(knowledgeSource.organizationId, testOrganizations),
        ),
      )
    // ...open conversations, which closeIdleConversations would close and
    // then queue contact facts for (closed here, so nothing is queued)...
    await tx
      .update(conversation)
      .set({ status: 'closed', closedAt: now })
      .where(
        and(
          eq(conversation.status, 'open'),
          inArray(conversation.assistantId, testAssistants),
        ),
      )
    // ...and WhatsApp agents still polled (ensureWhatsappPollers).
    await tx
      .update(whatsappAgent)
      .set({ status: 'broken' })
      .where(
        and(
          inArray(whatsappAgent.status, ['waiting_for_hi', 'linked']),
          inArray(whatsappAgent.organizationId, testOrganizations),
        ),
      )
  })
}

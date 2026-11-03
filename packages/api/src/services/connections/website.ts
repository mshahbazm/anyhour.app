import { and, eq, notInArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import { assistant, connection } from '../../db/schema'
import { forgetSiteSettings } from '../widget/site'

// Website chat channels: one `website` connection per site in a workspace,
// answered by the workspace's AI. `assistant.allowedOrigins` is still
// written alongside, so older installs and code that reads it keep working
// until it can be dropped.

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type tDb = typeof db | tTransaction

// The AI's allowed websites changed (Install, a new business website): each
// new site becomes a channel it answers; a site it dropped stops being one.
export async function syncWebsiteChannels(
  tx: tDb,
  organizationId: string,
  assistantId: string,
  origins: readonly string[],
) {
  if (origins.length)
    await tx
      .insert(connection)
      .values(
        origins.map((origin) => ({
          organizationId,
          provider: 'website' as const,
          externalAccountId: origin,
          assistantId,
        })),
      )
      .onConflictDoNothing()
  await tx
    .delete(connection)
    .where(
      and(
        eq(connection.organizationId, organizationId),
        eq(connection.provider, 'website'),
        eq(connection.assistantId, assistantId),
        origins.length
          ? notInArray(connection.externalAccountId, [...origins])
          : undefined,
      ),
    )
  forgetWidgetSites()
}

/** The chat may load on this website for this AI. */
export async function answersWebsite(assistantId: string, origin: string) {
  const [row] = await db
    .select({ id: connection.id })
    .from(connection)
    .where(
      and(
        eq(connection.provider, 'website'),
        eq(connection.assistantId, assistantId),
        eq(connection.externalAccountId, origin),
        eq(connection.status, 'active'),
      ),
    )
    .limit(1)
  return Boolean(row)
}

// A removed website channel also leaves the AI's allowed websites.
export async function removeWebsiteOrigin(
  tx: tDb,
  record: { externalAccountId: string; assistantId: string | null },
) {
  if (!record.assistantId) return
  await tx
    .update(assistant)
    .set({
      allowedOrigins: sql`coalesce((select jsonb_agg(value) from jsonb_array_elements_text(${assistant.allowedOrigins}) as value where value <> ${record.externalAccountId}), '[]'::jsonb)`,
    })
    .where(eq(assistant.id, record.assistantId))
  forgetSiteSettings(record.assistantId)
  forgetWidgetSites()
}

// The install code names either the AI (`data-bot`) or a website channel
// (`data-site`); every widget request resolves the id to the AI that
// answers it. Remembered briefly, like site.ts.
const limits = { ttlMs: 30_000, remembered: 5_000 }
const resolved = new Map<string, { assistantId: string; at: number }>()

export async function widgetAssistantId(id: string) {
  const now = Date.now()
  const hit = resolved.get(id)
  if (hit && now - hit.at < limits.ttlMs) return hit.assistantId
  const [channel] = await db
    .select({ assistantId: connection.assistantId, status: connection.status })
    .from(connection)
    .where(and(eq(connection.id, id), eq(connection.provider, 'website')))
    .limit(1)
  // A channel nobody answers resolves to nothing the widget can load.
  const assistantId = channel
    ? channel.status === 'active' && channel.assistantId
      ? channel.assistantId
      : ''
    : id
  resolved.delete(id)
  resolved.set(id, { assistantId, at: now })
  if (resolved.size > limits.remembered)
    resolved.delete(resolved.keys().next().value as string)
  return assistantId
}

export function forgetWidgetSites() {
  resolved.clear()
}

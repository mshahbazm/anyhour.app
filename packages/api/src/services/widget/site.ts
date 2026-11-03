import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { assistant, connection } from '../../db/schema'

const limits = { ttlMs: 30_000, remembered: 5_000 }

async function load(assistantId: string) {
  const [row] = await db
    .select({
      id: assistant.id,
      status: assistant.status,
      allowedOrigins: assistant.allowedOrigins,
      tracking: assistant.tracking,
      trackingOptions: assistant.trackingOptions,
    })
    .from(assistant)
    .where(eq(assistant.id, assistantId))
    .limit(1)
  if (!row) return null
  // Its website channels, and the older allowed list written alongside.
  const channels = await db
    .select({ origin: connection.externalAccountId })
    .from(connection)
    .where(
      and(
        eq(connection.provider, 'website'),
        eq(connection.assistantId, assistantId),
        eq(connection.status, 'active'),
      ),
    )
  return {
    ...row,
    allowedOrigins: [
      ...new Set([
        ...row.allowedOrigins,
        ...channels.map((item) => item.origin),
      ]),
    ],
  }
}

type tSite = Awaited<ReturnType<typeof load>>

// The few bot settings every public widget request checks (is it live, is
// this website allowed, what visitor counts count), remembered briefly so page
// loads and beacons don't each cost a database read. Changes from the
// dashboard clear it here at once; other server processes catch up within
// the TTL.
const remembered = new Map<string, { site: tSite; at: number }>()

export async function siteSettings(assistantId: string) {
  const now = Date.now()
  const hit = remembered.get(assistantId)
  if (hit && now - hit.at < limits.ttlMs) return hit.site
  const site = await load(assistantId)
  remembered.delete(assistantId)
  remembered.set(assistantId, { site, at: now })
  if (remembered.size > limits.remembered)
    remembered.delete(remembered.keys().next().value as string)
  return site
}

export function forgetSiteSettings(assistantId: string) {
  remembered.delete(assistantId)
}

/** The bot is live and this website may show it. */
export async function allowedSite(assistantId: string, origin?: string) {
  if (!origin || origin === 'null') return null
  const site = await siteSettings(assistantId)
  return site?.status === 'published' && site.allowedOrigins.includes(origin)
    ? site
    : null
}

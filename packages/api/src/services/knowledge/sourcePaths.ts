import { eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { knowledgeSource } from '../../db/schema'
import { pathAllowed } from './web'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function reconcileWebsitePaths(
  rootId: string,
  database: typeof db | tTransaction = db,
) {
  const [root] = await database
    .select()
    .from(knowledgeSource)
    .where(eq(knowledgeSource.id, rootId))
    .limit(1)
  if (!root || root.kind !== 'website') return
  const pages = await database
    .select()
    .from(knowledgeSource)
    .where(eq(knowledgeSource.parentId, root.id))
  const excluded: string[] = []
  const pending: string[] = []
  for (const page of pages) {
    if (page.archivedAt) continue
    if (!page.canonicalUrl) continue
    const allowed = [
      page.canonicalUrl,
      page.evidenceUrl ?? page.canonicalUrl,
    ].every((url) => pathAllowed(url, root.includePaths, root.excludePaths))
    if (!allowed && page.status !== 'excluded') excluded.push(page.id)
    else if (allowed && page.status === 'excluded') pending.push(page.id)
  }
  for (const [status, ids] of [
    ['excluded', excluded],
    ['pending', pending],
  ] as const)
    for (let start = 0; start < ids.length; start += 1000)
      await database
        .update(knowledgeSource)
        .set({
          status,
          ...(status === 'pending'
            ? { etag: null, lastModifiedHeader: null }
            : {}),
        })
        .where(inArray(knowledgeSource.id, ids.slice(start, start + 1000)))
}

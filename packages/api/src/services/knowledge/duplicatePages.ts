import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { knowledgeSource } from '../../db/schema'
import { preferredPage } from './pageTwins'
import { normalizeUrl } from './web'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

const duplicateNote = 'Same page as '

// A copy set aside while the page it repeats is still learned. Reading skips
// it; if that page goes away, the copy counts again.
const keptPageIsReady = sql`exists (
  select 1 from knowledge_source kept
  where kept.parent_id = ${knowledgeSource.parentId}
    and kept.status = 'ready'
    and ${knowledgeSource.lastError} = ${duplicateNote} || kept.canonical_url
)`

export async function isRecordedDuplicate(rootId: string, url: string) {
  const [copy] = await db
    .select({ id: knowledgeSource.id })
    .from(knowledgeSource)
    .where(
      and(
        eq(knowledgeSource.parentId, rootId),
        eq(knowledgeSource.canonicalUrl, url),
        eq(knowledgeSource.status, 'excluded'),
        keptPageIsReady,
      ),
    )
    .limit(1)
  return Boolean(copy)
}

function sameAddress(url: string) {
  try {
    return normalizeUrl(url)
  } catch {
    return url
  }
}

// After a website is read, keep one page per address and per content. Pages
// saved before an address rule existed ("/index.html" beside "/") and pages
// with identical text at unrelated addresses are set aside at the best one.
export async function setAsideDuplicatePages(tx: tTransaction, rootId: string) {
  const pages = await tx
    .select({
      id: knowledgeSource.id,
      url: knowledgeSource.canonicalUrl,
      hash: knowledgeSource.contentHash,
    })
    .from(knowledgeSource)
    .where(
      and(
        eq(knowledgeSource.parentId, rootId),
        eq(knowledgeSource.kind, 'webPage'),
        eq(knowledgeSource.status, 'ready'),
      ),
    )
  const setAside = new Map<string, string>()
  const keepOne = (
    groupOf: (page: (typeof pages)[number]) => string | null,
  ) => {
    const groups = new Map<string, typeof pages>()
    for (const page of pages) {
      const key = page.url && !setAside.has(page.id) ? groupOf(page) : null
      if (key) groups.set(key, [...(groups.get(key) ?? []), page])
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const kept = group.reduce((best, page) =>
        preferredPage(best.url!, page.url!) === best.url ? best : page,
      )
      for (const page of group)
        if (page !== kept) setAside.set(page.id, kept.url!)
    }
  }
  keepOne((page) => sameAddress(page.url!))
  keepOne((page) => page.hash)
  for (const [id, keptUrl] of setAside)
    await tx
      .update(knowledgeSource)
      .set({ status: 'excluded', lastError: `${duplicateNote}${keptUrl}` })
      .where(
        and(eq(knowledgeSource.id, id), eq(knowledgeSource.status, 'ready')),
      )
}

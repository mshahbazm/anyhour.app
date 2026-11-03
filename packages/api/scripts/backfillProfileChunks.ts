import { and, asc, eq, gt, inArray, isNotNull } from 'drizzle-orm'
import { db } from '../src/db'
import { knowledgeChunk, knowledgeSource } from '../src/db/schema'
import { ownedBy } from '../src/services/knowledge/owner'
import { buildProfileChunk } from '../src/services/knowledge/profileChunk'
import { searchableSource } from '../src/services/knowledge/sourceEligibility'
import { syncStoredProfileChunk } from '../src/services/knowledge/syncProfileChunk'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
let organizationId: string | undefined
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--apply') continue
  if (
    args[i] === '--workspace' &&
    args[i + 1] &&
    !args[i + 1].startsWith('--')
  ) {
    organizationId = args[++i]
    continue
  }
  throw new Error(
    'Usage: bun run knowledge:backfill-profiles [--workspace <organizationId>] [--apply]',
  )
}
try {
  let candidates = 0,
    updated = 0
  // Bound memory on large sites and read existing chunks with the batch instead
  // of issuing another query for every source, including preview-only runs.
  let afterId: string | undefined
  while (true) {
    const sources = await db
      .select({
        id: knowledgeSource.id,
        title: knowledgeSource.title,
        profile: knowledgeSource.pageProfile,
        previousText: knowledgeChunk.text,
      })
      .from(knowledgeSource)
      .leftJoin(
        knowledgeChunk,
        and(
          eq(knowledgeChunk.sourceId, knowledgeSource.id),
          eq(knowledgeChunk.kind, 'pageProfile'),
        ),
      )
      .where(
        and(
          organizationId
            ? ownedBy(knowledgeSource, { organizationId })
            : undefined,
          afterId ? gt(knowledgeSource.id, afterId) : undefined,
          inArray(knowledgeSource.kind, ['webPage', 'publicDocument']),
          isNotNull(knowledgeSource.pageProfile),
          searchableSource(),
        ),
      )
      .orderBy(asc(knowledgeSource.id))
      .limit(100)
    if (!sources.length) break
    for (const source of sources) {
      const text = buildProfileChunk(source.title, source.profile)
      if (text === source.previousText) continue
      candidates++
      if (apply && (await syncStoredProfileChunk(source.id))) updated++
    }
    afterId = sources.at(-1)!.id
  }
  console.info(
    apply
      ? `${updated} page-profile embeddings updated (${candidates} candidates).`
      : `${candidates} page-profile embeddings need updating (preview only).`,
  )
} finally {
  await db.$client.end()
}

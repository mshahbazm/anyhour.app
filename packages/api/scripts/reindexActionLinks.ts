import { and, inArray, sql } from 'drizzle-orm'
import { db } from '../src/db'
import { knowledgeSource } from '../src/db/schema'
import { knowledgeFormatVersion } from '../src/services/knowledge/cleanup/formatBlocks'
import { searchableSource } from '../src/services/knowledge/sourceEligibility'
import { ownerOf, ownedBy } from '../src/services/knowledge/owner'
import { queueRun } from '../src/services/knowledge/runRequests'
import { getBoss } from '../src/services/queue/boss'

// Preview by default. --apply queues fresh runs; the separate worker processes
// them. Optionally scope to one workspace with --workspace <organizationId>.
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
    'Usage: bun run knowledge:reindex-links [--workspace <organizationId>] [--apply]',
  )
}

try {
  const pages = await db
    .select({
      organizationId: knowledgeSource.organizationId,
      id: knowledgeSource.id,
      parentId: knowledgeSource.parentId,
    })
    .from(knowledgeSource)
    .where(
      and(
        organizationId
          ? ownedBy(knowledgeSource, { organizationId })
          : undefined,
        inArray(knowledgeSource.kind, ['webPage', 'publicDocument']),
        searchableSource(),
        sql`coalesce(${
          knowledgeSource.contentHash
        }, '') not like ${`${knowledgeFormatVersion}:%`}`,
      ),
    )
  const targets = new Map(
    pages.map((page) => [page.parentId ?? page.id, ownerOf(page)]),
  )
  console.info(
    `${pages.length} legacy pages across ${targets.size} source refreshes${
      apply ? '' : ' (preview only)'
    }.`,
  )
  if (apply) {
    try {
      for (const [sourceId, owner] of targets)
        await queueRun(owner, sourceId, 'manual')
      console.info(
        `Queued ${targets.size} source refreshes. Run the API worker to process them.`,
      )
    } finally {
      if (targets.size) await (await getBoss()).stop()
    }
  }
} finally {
  await db.$client.end()
}

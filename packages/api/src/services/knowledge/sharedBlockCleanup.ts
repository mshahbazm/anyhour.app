import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { knowledgeSharedBlock } from '../../db/schema'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

const orphaned = sql`not exists (select 1 from knowledge_shared_block_source link where link.block_id = ${knowledgeSharedBlock.id})`

export async function deleteOrphanSharedBlocks(
  tx: tTransaction,
  websiteId: string,
) {
  await tx
    .delete(knowledgeSharedBlock)
    .where(and(eq(knowledgeSharedBlock.websiteId, websiteId), orphaned))
}

export async function cleanupOrphanSharedBlocks() {
  await db
    .delete(knowledgeSharedBlock)
    .where(
      and(
        sql`${knowledgeSharedBlock.createdAt} < now() - interval '1 day'`,
        orphaned,
      ),
    )
}

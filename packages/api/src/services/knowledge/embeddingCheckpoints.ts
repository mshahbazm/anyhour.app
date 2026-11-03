import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { embeddingCheckpoint } from '../../db/schema'
import type { embeddingUsageRecorder } from './embeddingUsage'
import type { iEmbeddingCheckpoint } from './embedding'

// One cache serves content, profile, and shared batches for this run item.
// Hashes include the embedding contract and exact ordered input, not call order.
export function runEmbeddingCheckpoint(
  runId: string,
  sourceId: string,
  recordUsage: ReturnType<typeof embeddingUsageRecorder>,
): iEmbeddingCheckpoint {
  return {
    async read(inputHash) {
      const [row] = await db
        .select({ vectors: embeddingCheckpoint.vectors })
        .from(embeddingCheckpoint)
        .where(
          and(
            eq(embeddingCheckpoint.runId, runId),
            eq(embeddingCheckpoint.sourceId, sourceId),
            eq(embeddingCheckpoint.inputHash, inputHash),
          ),
        )
        .limit(1)
      return row?.vectors ?? null
    },
    async write(inputHash, vectors, tokens) {
      // The result and its usage form one durable checkpoint. A later usage
      // failure cannot strand persisted vectors without their accounting.
      await db.transaction(async (tx) => {
        await tx
          .insert(embeddingCheckpoint)
          .values({ runId, sourceId, inputHash, vectors })
          .onConflictDoUpdate({
            target: [
              embeddingCheckpoint.runId,
              embeddingCheckpoint.sourceId,
              embeddingCheckpoint.inputHash,
            ],
            set: { vectors },
          })
        await recordUsage(tokens, tx)
      })
    },
  }
}

// Terminal items cannot consume their checkpoints again. Active runs keep all
// successful batches until publication or terminal failure, including long waits.
export async function sweepEmbeddingCheckpoints() {
  await db.delete(embeddingCheckpoint).where(sql`exists (
    select 1 from index_run run where run.id = ${embeddingCheckpoint.runId}
      and run.status in ('completed', 'failed')
  ) or exists (
    select 1 from index_run_item item
    where item.run_id = ${embeddingCheckpoint.runId} and item.source_id = ${embeddingCheckpoint.sourceId}
      and item.status in ('indexed', 'unchanged', 'failed')
  )`)
}

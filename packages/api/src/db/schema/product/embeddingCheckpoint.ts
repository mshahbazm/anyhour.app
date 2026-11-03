import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { indexRun } from './indexRun'
import { knowledgeSource } from './knowledgeSource'

export const embeddingCheckpoint = pgTable(
  'embedding_checkpoint',
  {
    runId: text('run_id')
      .notNull()
      .references(() => indexRun.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => knowledgeSource.id, { onDelete: 'cascade' }),
    inputHash: text('input_hash').notNull(),
    vectors: jsonb('vectors').$type<number[][]>().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.sourceId, table.inputHash] }),
    index('embedding_checkpoint_source_idx').on(table.sourceId),
  ],
)

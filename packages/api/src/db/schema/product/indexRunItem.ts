import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { indexRun } from './indexRun'
import { knowledgeSource } from './knowledgeSource'

export const indexRunItem = pgTable(
  'index_run_item',
  {
    runId: text('run_id')
      .notNull()
      .references(() => indexRun.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => knowledgeSource.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: [
        'queued',
        'preparing',
        'prepared',
        'embedding',
        'indexed',
        'unchanged',
        'failed',
      ],
    })
      .notNull()
      .default('queued'),
    stagedContentKey: text('staged_content_key'),
    attemptCount: integer('attempt_count').notNull().default(0),
    prepareAttempts: integer('prepare_attempts').notNull().default(0),
    embedAttempts: integer('embed_attempts').notNull().default(0),
    leaseUntil: timestamp('lease_until'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
  },
  (table) => [primaryKey({ columns: [table.runId, table.sourceId] })],
)

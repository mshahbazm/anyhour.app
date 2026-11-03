import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// No source/assistant foreign key: cleanup must survive deletion of its owner.
export const storageCleanup = pgTable(
  'storage_cleanup',
  {
    objectKey: text('object_key').primaryKey(),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at').defaultNow().notNull(),
    leaseUntil: timestamp('lease_until'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('storage_cleanup_next_attempt_idx').on(table.nextAttemptAt),
  ],
)

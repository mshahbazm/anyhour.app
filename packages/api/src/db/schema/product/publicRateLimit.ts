import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

export const publicRateLimit = pgTable(
  'public_rate_limit',
  {
    keyHash: text('key_hash').notNull(),
    bucketStart: timestamp('bucket_start').notNull(),
    requestCount: integer('request_count').notNull().default(0),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.keyHash, table.bucketStart] })],
)

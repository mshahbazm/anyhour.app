import { sql } from 'drizzle-orm'
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { connection } from './connection'

// Inbound events from a connection (a Slack event or button): stored before they are acked, so a redelivery is
// handled once, then processed by the `connection-event` job. Pruned after
// teamChatConfig.keepEventsDays.
export const connectionEvent = pgTable(
  'connection_event',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    externalEventId: text('external_event_id').notNull(),
    // message, mention, action, uninstalled
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
    processedAt: timestamp('processed_at'),
    error: text('error'),
  },
  (table) => [
    uniqueIndex('connection_event_external_idx').on(
      table.connectionId,
      table.externalEventId,
    ),
    index('connection_event_prune_idx')
      .on(table.receivedAt)
      .where(sql`${table.processedAt} is not null`),
  ],
)

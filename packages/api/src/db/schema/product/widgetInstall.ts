import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { assistant } from './assistant'

// Where a bot's chat code has been seen loading, from the widget's own
// heartbeat (its bootstrap request). Tells the owner whether the install
// works, and catches the code on a site that isn't allowed yet.
export const widgetInstall = pgTable(
  'widget_install',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    assistantId: text('assistant_id')
      .notNull()
      .references(() => assistant.id, { onDelete: 'cascade' }),
    origin: text('origin').notNull(),
    /** working: chat loads; notAllowed: site not on the list; notLive: bot offline. */
    status: text('status', {
      enum: ['working', 'notAllowed', 'notLive'],
    }).notNull(),
    firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('widget_install_origin_unique').on(
      table.assistantId,
      table.origin,
    ),
    index('widget_install_assistant_idx').on(table.assistantId),
  ],
)

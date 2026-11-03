import { date, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { assistant } from './assistant'

// Which anonymous visitors were already counted today, so unique visitors
// are counted once. The hash changes daily and can't be traced back to a
// person; rows are deleted after a couple of days.
export const siteVisitorDaily = pgTable(
  'site_visitor_daily',
  {
    assistantId: text('assistant_id')
      .notNull()
      .references(() => assistant.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    visitorHash: text('visitor_hash').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.assistantId, table.day, table.visitorHash] }),
  ],
)

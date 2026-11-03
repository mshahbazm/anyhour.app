import { date, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { assistant } from './assistant'

// A bot's website insights as daily counts: one row per day, metric and
// value (a page, a country…). Small and cheap whatever the traffic; no
// visitor-level rows are kept. See services/insights/.
export const siteStatDaily = pgTable(
  'site_stat_daily',
  {
    assistantId: text('assistant_id')
      .notNull()
      .references(() => assistant.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    /** views, visitors, opens, prompts, page, source, country, device, browser */
    metric: text('metric').notNull(),
    /** Empty for a total; else the page, country code, etc. */
    value: text('value').notNull().default(''),
    count: integer('count').notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.assistantId, table.day, table.metric, table.value],
    }),
  ],
)

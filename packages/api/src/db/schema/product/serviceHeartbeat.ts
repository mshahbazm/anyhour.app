import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Background services report in regularly, so the app can tell queued work
// that is waiting its turn from work nothing is running to pick up.
export const serviceHeartbeat = pgTable('service_heartbeat', {
  name: text('name').primaryKey(),
  beatAt: timestamp('beat_at').notNull(),
})

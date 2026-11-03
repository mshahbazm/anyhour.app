import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './user'
import { organization } from './organization'

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activeOrganizationId: text('active_organization_id').references(
      () => organization.id,
      { onDelete: 'set null' },
    ),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

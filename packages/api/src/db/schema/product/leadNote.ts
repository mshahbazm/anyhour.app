import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { member } from '../auth/member'
import { lead } from './lead'

export const leadNote = pgTable(
  'lead_note',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    leadId: text('lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    authorMemberId: text('author_member_id').references(() => member.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('lead_note_lead_idx').on(table.leadId)],
)

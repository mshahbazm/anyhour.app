import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { contact } from './contact'
import { lead } from './lead'

// Strongest first: a merge that finds both contacts on a deal keeps the
// stronger role.
export const leadContactRoles = [
  'requester',
  'decision_maker',
  'point_of_contact',
  'billing',
  'other',
] as const
export type tLeadContactRole = (typeof leadContactRoles)[number]

// The people on a deal. The lead's contactId is its requester and always has
// a row here.
export const leadContact = pgTable(
  'lead_contact',
  {
    leadId: text('lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contact.id, { onDelete: 'cascade' }),
    role: text('role', { enum: leadContactRoles }).notNull(),
    addedAt: timestamp('added_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.leadId, table.contactId] }),
    index('lead_contact_contact_idx').on(table.contactId),
  ],
)

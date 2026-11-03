import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { member } from '../auth/member'
import { organization } from '../auth/organization'
import { lead } from './lead'

export const leadActivityKinds = [
  'captured',
  'status_changed',
  'note_added',
  'email_received',
  'owner_notified',
  'qualified',
  'contact_added',
  'contact_removed',
  'contact_role_changed',
  'contacts_merged',
] as const
export type tLeadActivityKind = (typeof leadActivityKinds)[number]

// The lead's timeline: what happened, and who did it.
export const leadActivity = pgTable(
  'lead_activity',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    leadId: text('lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: leadActivityKinds }).notNull(),
    title: text('title').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    actorMemberId: text('actor_member_id').references(() => member.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('lead_activity_lead_created_idx').on(table.leadId, table.createdAt),
  ],
)

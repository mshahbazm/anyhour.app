import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { member } from '../auth/member'
import { organization } from '../auth/organization'
import { contact } from './contact'
import { conversation } from './conversation'

// Something worth remembering about a contact ("prefers evenings"). Owner-facing
// only: the visitor bot never reads these.
export const contactFact = pgTable(
  'contact_fact',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contact.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    source: text('source', { enum: ['agent', 'member'] }).notNull(),
    // The conversation the agent learned it from.
    conversationId: text('conversation_id').references(() => conversation.id, {
      onDelete: 'set null',
    }),
    createdByMemberId: text('created_by_member_id').references(
      () => member.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('contact_fact_contact_created_idx').on(
      table.contactId,
      table.createdAt,
    ),
  ],
)

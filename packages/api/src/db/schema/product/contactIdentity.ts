import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organization } from '../auth/organization'
import { contact } from './contact'

export const contactIdentityKinds = ['email', 'phone', 'whatsapp'] as const
export type tContactIdentityKind = (typeof contactIdentityKinds)[number]

export const contactIdentitySources = [
  'chat',
  'manual',
  'merge',
  'backfill',
] as const
export type tContactIdentitySource = (typeof contactIdentitySources)[number]

// One way of reaching a contact. A normalized value belongs to at most one
// contact per workspace, so capture links a returning person by it.
export const contactIdentity = pgTable(
  'contact_identity',
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
    kind: text('kind', { enum: contactIdentityKinds }).notNull(),
    // As given, for display.
    value: text('value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    source: text('source', { enum: contactIdentitySources }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('contact_identity_org_kind_value_unique').on(
      table.organizationId,
      table.kind,
      table.normalizedValue,
    ),
    index('contact_identity_contact_idx').on(table.contactId),
  ],
)

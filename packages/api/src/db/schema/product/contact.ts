import { sql } from 'drizzle-orm'
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organization } from '../auth/organization'

export const contact = pgTable(
  'contact',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    name: text('name'),
    // Display values, kept equal to one of the contact's identities of that
    // kind when it has one (contact_identity is what capture matches on).
    email: text('email'),
    normalizedEmail: text('normalized_email'),
    phone: text('phone'),
    normalizedPhone: text('normalized_phone'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('contact_org_created_id_idx').on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
    uniqueIndex('contact_org_email_unique')
      .on(table.organizationId, table.normalizedEmail)
      .where(sql`${table.normalizedEmail} is not null`),
    uniqueIndex('contact_org_phone_unique')
      .on(table.organizationId, table.normalizedPhone)
      .where(sql`${table.normalizedPhone} is not null`),
  ],
)

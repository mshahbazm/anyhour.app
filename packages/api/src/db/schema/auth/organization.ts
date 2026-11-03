import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import type { tBusinessHours } from '../../../types/businessHours.types'

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  metadata: text('metadata'),
  // Owner-edited description of the business; falls back to the homepage profile.
  businessAbout: text('business_about'),
  // Plain-words description of the leads the business wants; leads are scored against it.
  idealCustomerProfile: text('ideal_customer_profile'),
  // IANA name ("Europe/London"): the browser's at sign-up, or the one the
  // business's knowledge names. Opening hours are local to it.
  timeZone: text('time_zone'),
  // Opening hours read from Your business (services/workspace/businessHours.ts);
  // null until found.
  businessHours: jsonb('business_hours').$type<tBusinessHours>(),
})

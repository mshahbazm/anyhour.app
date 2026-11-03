import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organization } from '../auth/organization'
import { knowledgeSource } from './knowledgeSource'

// A fact the owner told the bot (a note) that knowingly overrides what one of
// their pages says. When that page changes, the bot re-checks it: the site
// catching up retires it, a new conflict waits for the owner's decision, and
// the owner's version keeps being used until they decide.
export const knowledgeCorrection = pgTable(
  'knowledge_correction',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    noteId: text('note_id')
      .notNull()
      .references(() => knowledgeSource.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => knowledgeSource.id, { onDelete: 'cascade' }),
    /** What the page said when the owner chose their own version. */
    excerpt: text('excerpt').notNull(),
    /** The page version that excerpt was read from. */
    sourceHash: text('source_hash'),
    status: text('status', { enum: ['active', 'needsReview', 'retired'] })
      .notNull()
      .default('active'),
    /** What the page says now, while it waits for the owner's decision. */
    websiteNow: text('website_now'),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('knowledge_correction_note_source_unique').on(
      table.noteId,
      table.sourceId,
    ),
    index('knowledge_correction_organization_status_idx').on(
      table.organizationId,
      table.status,
    ),
    index('knowledge_correction_source_idx').on(table.sourceId),
  ],
)

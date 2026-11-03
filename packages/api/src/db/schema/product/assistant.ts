import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  integer,
} from 'drizzle-orm/pg-core'
import { organization } from '../auth/organization'
import { defaultAppearance } from '../../../config/appearance.config'
import type { iAppearance } from '../../../config/appearance.config'
import type { iKnowledgeOverview } from '../../../config/knowledgeOverview.config'
import type { tBehaviour } from '../../../config/behaviour.config'
import { defaultTracking } from '../../../config/tracking.config'
import type { tTracking } from '../../../config/tracking.config'

// The workspace's AI (docs/focusedProduct.md, "One AI per business"): one
// row per workspace, made at sign-up; services/assistants/workspaceAi.ts
// resolves it.
export const assistant = pgTable(
  'assistant',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    name: text('name').notNull(),
    // One plain sentence: what the AI does; null until written.
    job: text('job'),
    // R2 object key of the generated profile picture.
    pictureKey: text('picture_key'),
    goal: text('goal', { enum: ['answers', 'enquiries', 'both'] }),
    goalNotes: text('goal_notes'),
    // Structured guidance for visitor chats (see config/behaviour.config.ts).
    behaviour: jsonb('behaviour').$type<tBehaviour>().notNull().default({}),
    // The bot's overall picture of the business (see config/knowledgeOverview.config.ts).
    knowledgeOverview: jsonb('knowledge_overview').$type<iKnowledgeOverview>(),
    // Hash of the inputs it was built from; an unchanged hash skips the rebuild.
    overviewFingerprint: text('overview_fingerprint'),
    overviewUpdatedAt: timestamp('overview_updated_at'),
    // Widget look on the website (see config/appearance.config.ts).
    appearance: jsonb('appearance')
      .$type<iAppearance>()
      .notNull()
      .default(defaultAppearance),
    // Website insights: whether the chat counts visits and visitors on the
    // website (services/insights/). The owner turns it on; off by default.
    tracking: boolean('tracking').notNull().default(false),
    // What it counts while that's on (see config/tracking.config.ts).
    trackingOptions: jsonb('tracking_options')
      .$type<tTracking>()
      .notNull()
      .default(defaultTracking),
    welcomeMessage: text('welcome_message')
      .notNull()
      .default('How can I help?'),
    status: text('status', { enum: ['draft', 'published'] })
      .notNull()
      .default('draft'),
    allowedOrigins: jsonb('allowed_origins')
      .$type<string[]>()
      .notNull()
      .default([]),
    refreshIntervalHours: integer('refresh_interval_hours'),
    nextRefreshAt: timestamp('next_refresh_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('assistant_organization_idx').on(table.organizationId)],
)

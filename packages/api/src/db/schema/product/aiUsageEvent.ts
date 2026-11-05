import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { organization } from '../auth/organization'
import { assistant } from './assistant'
import { conversation } from './conversation'
import { knowledgeSource } from './knowledgeSource'

export const aiUsageEvent = pgTable(
  'ai_usage_event',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    assistantId: text('assistant_id').references(() => assistant.id),
    conversationId: text('conversation_id').references(() => conversation.id, {
      onDelete: 'set null',
    }),
    sourceId: text('source_id').references(() => knowledgeSource.id, {
      onDelete: 'set null',
    }),
    kind: text('kind', {
      enum: [
        'chat',
        'embedding',
        'cleanup',
        // Which parts of a new website to read (scopePlan.ts).
        'scopePlan',
        'pageProfile',
        'knowledgeOverview',
        'gapCheck',
        'factConflict',
        'correctionCheck',
        'noteRewrite',
        'documentTranscription',
        'portraitBrief',
        'leadQualification',
        'askFirstSuggestions',
        'contactFacts',
        'ruleDrafts',
        'contactDrafts',
        'handoffReply',
        'noteOffer',
        'businessHours',
        'noteDrafts',
        'whatsappNumber',
      ],
    }).notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 16, scale: 10 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('ai_usage_organization_created_idx').on(
      table.organizationId,
      table.createdAt,
    ),
  ],
)

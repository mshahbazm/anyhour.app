import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core'
import { assistant } from './assistant'
import { conversation } from './conversation'

// A question a real visitor asked that the bot couldn't answer. It is
// re-checked against the bot's own search whenever knowledge changes, and
// closes itself once the knowledge answers it.
export const knowledgeGap = pgTable(
  'knowledge_gap',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    assistantId: text('assistant_id')
      .notNull()
      .references(() => assistant.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    /** Normalised question, so the same question asked twice is one gap. */
    questionKey: text('question_key').notNull(),
    // The question's meaning, so reworded duplicates merge into one gap.
    embedding: vector('embedding', { dimensions: 384 }),
    status: text('status', { enum: ['open', 'answered', 'dismissed'] })
      .notNull()
      .default('open'),
    askCount: integer('ask_count').notNull().default(0),
    lastAskedAt: timestamp('last_asked_at'),
    // The latest visitor conversation that asked it.
    conversationId: text('conversation_id').references(() => conversation.id, {
      onDelete: 'set null',
    }),
    checkedAt: timestamp('checked_at'),
    resolvedAt: timestamp('resolved_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('knowledge_gap_question_unique').on(
      table.assistantId,
      table.questionKey,
    ),
    index('knowledge_gap_assistant_status_idx').on(
      table.assistantId,
      table.status,
    ),
  ],
)

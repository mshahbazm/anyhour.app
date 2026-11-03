import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { workspaceMessage } from './workspaceMessage'

export const workspaceAction = pgTable(
  'workspace_action',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    messageId: text('message_id')
      .notNull()
      .references(() => workspaceMessage.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    result: jsonb('result').$type<unknown>(),
    status: text('status', {
      enum: ['running', 'completed', 'failed', 'unknown'],
    })
      .notNull()
      .default('running'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (table) => [index('workspace_action_message_idx').on(table.messageId)],
)

import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { teamChatApps } from '../../../config/teamChat.config'
import { workspaceChat } from './workspaceChat'

export const workspaceMessage = pgTable(
  'workspace_message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    chatId: text('chat_id')
      .notNull()
      .references(() => workspaceChat.id, { onDelete: 'cascade' }),
    clientMessageId: text('client_message_id').notNull(),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull().default(''),
    // The chat app it was said in; null for the dashboard.
    via: text('via', { enum: teamChatApps }),
    status: text('status', { enum: ['running', 'completed', 'failed'] })
      .notNull()
      .default('completed'),
    errorCode: text('error_code'),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (table) => [
    uniqueIndex('workspace_message_client_unique').on(
      table.chatId,
      table.clientMessageId,
      table.role,
    ),
    index('workspace_message_chat_created_idx').on(
      table.chatId,
      table.createdAt,
    ),
  ],
)

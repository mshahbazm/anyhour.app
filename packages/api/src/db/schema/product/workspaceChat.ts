import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { user } from '../auth/user'
import { organization } from '../auth/organization'
import { assistant } from './assistant'

export const workspaceChat = pgTable(
  'workspace_chat',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    assistantId: text('assistant_id').references(() => assistant.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull().default('Knowledge setup'),
    // The person's one thread with the AI, shared by the dashboard, WhatsApp
    // and Slack (services/teamChat/thread.ts).
    shared: boolean('shared').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('workspace_chat_user_org_idx').on(table.userId, table.organizationId),
    uniqueIndex('workspace_chat_shared_idx')
      .on(table.userId, table.organizationId, table.assistantId)
      .where(sql`${table.shared}`),
  ],
)

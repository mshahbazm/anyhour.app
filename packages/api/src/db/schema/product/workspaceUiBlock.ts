import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { workspaceChat } from './workspaceChat'
import { workspaceMessage } from './workspaceMessage'
import type { tWorkspaceUi } from '../../../schemas/workspaceUi.schema'

export interface iPendingNote {
  noteId: string | null
  title: string
  text: string
  overrides: Array<{ sourceId: string; excerpt: string }>
  // The staff reply a new note was learned from (an answer learned).
  fromMessageId?: string | null
}

// A hard-to-undo tool call from a chat app, held until the member confirms
// (config/teamChat.config.ts confirmFirstTools).
export interface iPendingAction {
  name: string
  input: Record<string, unknown>
}

export const workspaceUiBlock = pgTable(
  'workspace_ui_block',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    chatId: text('chat_id')
      .notNull()
      .references(() => workspaceChat.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => workspaceMessage.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<tWorkspaceUi>().notNull(),
    status: text('status', {
      enum: ['pending', 'resolved', 'superseded', 'consumed'],
    })
      .notNull()
      .default('pending'),
    resolvedValue: text('resolved_value'),
    responseReplyId: text('response_reply_id'),
    // Server-created removal binding; model-authored UI cannot authorize a removal.
    removalMemberId: text('removal_member_id'),
    removalRole: text('removal_role'),
    // Server-created fact change that a website-conflict confirmation applies.
    pendingNote: jsonb('pending_note').$type<iPendingNote>(),
    pendingAction: jsonb('pending_action').$type<iPendingAction>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at'),
  },
  (table) => [index('workspace_ui_block_chat_idx').on(table.chatId)],
)

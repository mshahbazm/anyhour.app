import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { conversation } from './conversation'
import { lead } from './lead'

export const leadConversation = pgTable(
  'lead_conversation',
  {
    leadId: text('lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    linkedAt: timestamp('linked_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.leadId, table.conversationId] }),
    // Finds a conversation's leads (each visitor message, the idle sweep).
    index('lead_conversation_conversation_idx').on(table.conversationId),
  ],
)

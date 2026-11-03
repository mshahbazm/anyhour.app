import { sql } from 'drizzle-orm'
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { tBlockReply, tChatBlock } from '../../../schemas/chatBlock.schema'
import { member } from '../auth/member'
import { conversation } from './conversation'

// A staff reply the AI offers to remember as a note in Your business
// (docs/support.md, "Your replies teach the AI"), until saved or dismissed.
export interface iNoteOffer {
  title: string
  text: string
}

// Where an outgoing message on a channel like WhatsApp got to, from the
// provider's status webhooks. Null for the website chat.
export const messageDeliveryStatuses = [
  'sent',
  'delivered',
  'read',
  'failed',
] as const
export type tMessageDeliveryStatus = (typeof messageDeliveryStatuses)[number]

export const message = pgTable(
  'message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: ['visitor', 'assistant', 'staff', 'tool'],
    }).notNull(),
    content: text('content').notNull(),
    status: text('status', { enum: ['pending', 'completed', 'failed'] })
      .notNull()
      .default('completed'),
    clientMessageId: text('client_message_id'),
    citations: jsonb('citations')
      .$type<
        Array<{ sourceId: string; url: string | null; title: string | null }>
      >()
      .notNull()
      .default([]),
    // The AI reply's chat UI block (at most one), validated with
    // chatBlocksSchema before it's stored.
    blocks: jsonb('blocks').$type<tChatBlock[]>().notNull().default([]),
    // A visitor's tap or contact form answering one of those blocks.
    blockReply: jsonb('block_reply').$type<tBlockReply>(),
    errorCode: text('error_code'),
    // Who on the team wrote a staff message.
    staffMemberId: text('staff_member_id').references(() => member.id, {
      onDelete: 'set null',
    }),
    // The provider's id for it (WhatsApp's wamid), for status webhooks.
    externalId: text('external_id'),
    deliveryStatus: text('delivery_status', { enum: messageDeliveryStatuses }),
    // Staff replies only: the note the AI offers to save from it, shown in
    // the inbox until the person saves it or says not now.
    noteOffer: jsonb('note_offer').$type<iNoteOffer>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
  },
  (table) => [
    index('message_conversation_created_idx').on(
      table.conversationId,
      table.createdAt,
    ),
    uniqueIndex('message_conversation_client_unique').on(
      table.conversationId,
      table.clientMessageId,
    ),
    index('message_external_idx')
      .on(table.externalId)
      .where(sql`${table.externalId} is not null`),
  ],
)

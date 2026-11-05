import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { assistant } from './assistant'
import { connection } from './connection'
import { contact } from './contact'
import { member } from '../auth/member'
import { user } from '../auth/user'

// Where a conversation happens: the website chat and the business's own
// WhatsApp number (docs/customerWhatsapp.md); the inbox is ready for the
// others (docs/support.md).
export const conversationChannels = ['widget', 'whatsapp', 'email'] as const
export type tConversationChannel = (typeof conversationChannels)[number]

// What the AI wrote when it handed a conversation to a person.
export interface iHandoffSummary {
  reason: 'asked_for_person' | 'problem' | 'not_sure' | 'money'
  // What the visitor wants, what is known, and a suggested next step.
  wants: string
  known: string | null
  nextStep: string | null
}

export const conversation = pgTable(
  'conversation',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    assistantId: text('assistant_id')
      .notNull()
      .references(() => assistant.id),
    contactId: text('contact_id').references(() => contact.id, {
      onDelete: 'set null',
    }),
    resumeTokenHash: text('resume_token_hash').notNull(),
    knownFields: jsonb('known_fields')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    entryUrl: text('entry_url'),
    status: text('status', { enum: ['open', 'closed'] })
      .notNull()
      .default('open'),
    isTest: boolean('is_test').notNull().default(false),
    channel: text('channel', { enum: conversationChannels })
      .notNull()
      .default('widget'),
    // A channel through a connection (WhatsApp Business): which number, and
    // the customer there (their wa_id). One per pair.
    connectionId: text('connection_id').references(() => connection.id, {
      onDelete: 'set null',
    }),
    externalUserId: text('external_user_id'),
    // agent: the AI replies; human: a member took it over and the
    // AI stays quiet until they let it continue.
    handledBy: text('handled_by', { enum: ['agent', 'human'] })
      .notNull()
      .default('agent'),
    assignedMemberId: text('assigned_member_id').references(() => member.id, {
      onDelete: 'set null',
    }),
    // Set while the visitor waits for a person; null otherwise.
    needsHumanSince: timestamp('needs_human_since'),
    // When the AI last handed it to a person (and alerted the owners); kept
    // after it's resolved, for the month's numbers.
    handedOffAt: timestamp('handed_off_at'),
    handoffSummary: jsonb('handoff_summary').$type<iHandoffSummary>(),
    // The AI's suggested reply for the member, owner-facing only.
    handoffDraft: text('handoff_draft'),
    // The WhatsApp question (docs/whatsappQuestion.md): when the visitor
    // first asked for WhatsApp, and first opened the WhatsApp button.
    whatsappAskedAt: timestamp('whatsapp_asked_at'),
    whatsappOpenedAt: timestamp('whatsapp_opened_at'),
    previewUserId: text('preview_user_id').references(() => user.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastMessageAt: timestamp('last_message_at'),
    closedAt: timestamp('closed_at'),
  },
  (table) => [
    index('conversation_assistant_created_id_idx').on(
      table.assistantId,
      table.createdAt,
      table.id,
    ),
    index('conversation_assistant_last_message_idx').on(
      table.assistantId,
      table.lastMessageAt,
    ),
    index('conversation_needs_human_idx').on(
      table.assistantId,
      table.needsHumanSince,
    ),
    uniqueIndex('conversation_resume_token_hash_unique').on(
      table.resumeTokenHash,
    ),
    uniqueIndex('conversation_connection_user_unique')
      .on(table.connectionId, table.externalUserId)
      .where(sql`${table.connectionId} is not null`),
  ],
)

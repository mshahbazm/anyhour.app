import { sql } from 'drizzle-orm'
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organization } from '../auth/organization'
import { lead } from './lead'
import { whatsappAgent } from './whatsappAgent'

export const whatsappDirections = ['in', 'out'] as const
export type tWhatsappDirection = (typeof whatsappDirections)[number]

// out: lead_alert (a new lead or a handoff), reply (answers to the owner's
// messages). in: owner_message.
export const whatsappMessageKinds = [
  'lead_alert',
  'reply',
  'owner_message',
] as const
export type tWhatsappMessageKind = (typeof whatsappMessageKinds)[number]

// What went between the workspace and the owner's WhatsApp agent. An alert
// keeps the lead it is about.
export const whatsappMessage = pgTable(
  'whatsapp_message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // The agent it went through; null on rows from before agents were per
    // person.
    agentId: text('agent_id').references(() => whatsappAgent.id, {
      onDelete: 'set null',
    }),
    direction: text('direction', { enum: whatsappDirections }).notNull(),
    kind: text('kind', { enum: whatsappMessageKinds }).notNull(),
    // WhatsApp's message id; null while an outbound alert is being sent.
    waMessageId: text('wa_message_id'),
    // Inbound: the alert the owner quoted.
    quotedWaMessageId: text('quoted_wa_message_id'),
    text: text('text').notNull(),
    leadId: text('lead_id').references(() => lead.id, { onDelete: 'set null' }),
    // Outbound: when it was sent. Inbound: WhatsApp's timestamp.
    sentAt: timestamp('sent_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('whatsapp_message_organization_sent_idx').on(
      table.organizationId,
      table.sentAt,
    ),
    // A redelivered update is handled once.
    uniqueIndex('whatsapp_message_wa_id_idx')
      .on(table.organizationId, table.waMessageId)
      .where(sql`${table.waMessageId} is not null`),
  ],
)

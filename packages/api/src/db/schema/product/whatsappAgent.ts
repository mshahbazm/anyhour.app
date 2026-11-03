import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { member } from '../auth/member'
import { organization } from '../auth/organization'
import { assistant } from './assistant'

// waiting_for_hi: the key is stored, the owner hasn't messaged the agent yet.
// linked: we know who to message. broken: WhatsApp rejected the key (it was
// regenerated, or WhatsApp was reinstalled); alerts fall back to email.
export const whatsappAgentStatuses = [
  'waiting_for_hi',
  'linked',
  'broken',
] as const
export type tWhatsappAgentStatus = (typeof whatsappAgentStatuses)[number]

// A team member's personal WhatsApp agent (Agent Platform): the member
// talks to the AI in it and gets its alerts. It can message only the person
// who created it, so it is never a customer channel. One per person.
export const whatsappAgent = pgTable(
  'whatsapp_agent',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // The agent's API key, AES-GCM encrypted (services/whatsapp/secret.ts).
    // Never returned to a client.
    tokenEncrypted: text('token_encrypted').notNull(),
    // Keyed hash of the API key, so one agent can't be connected to two
    // workspaces (their pollers would fight over its updates).
    tokenFingerprint: text('token_fingerprint').notNull(),
    // The opaque `user:<id>` from the owner's latest inbound message; null
    // until their first message links them.
    ownerUserId: text('owner_user_id'),
    // Whose phone it is: messages from WhatsApp act as this member, and
    // the agent goes when they leave the workspace.
    connectedByMemberId: text('connected_by_member_id').references(
      () => member.id,
      { onDelete: 'cascade' },
    ),
    // The AI it talks as.
    assistantId: text('assistant_id').references(() => assistant.id, {
      onDelete: 'set null',
    }),
    // GET /updates offset, passed back exactly as WhatsApp returned it.
    pollOffset: text('poll_offset').notNull().default('0'),
    status: text('status', { enum: whatsappAgentStatuses })
      .notNull()
      .default('waiting_for_hi'),
    linkedAt: timestamp('linked_at'),
    lastPolledAt: timestamp('last_polled_at'),
    lastError: text('last_error'),
    // The next free send slot: WhatsApp allows 12 sends a minute per agent.
    nextSendAt: timestamp('next_send_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('whatsapp_agent_organization_idx').on(table.organizationId),
    // One agent per person and AI.
    uniqueIndex('whatsapp_agent_member_assistant_idx').on(
      table.connectedByMemberId,
      table.assistantId,
    ),
    uniqueIndex('whatsapp_agent_token_fingerprint_idx').on(
      table.tokenFingerprint,
    ),
  ],
)

import { sql } from 'drizzle-orm'
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { member } from '../auth/member'
import { organization } from '../auth/organization'
import { assistant } from './assistant'

// Outside systems a workspace connects (docs/channels.md, "Wave 3a"). Only
// what's built is listed: Slack, the team chat app, and the business's own
// WhatsApp number for customers (docs/customerWhatsapp.md). A `website` row is one website the chat answers on
// (docs/yourAi.md, "Channels"): not an outside system, so it has no provider
// module, only who answers it.
export const connectionProviders = [
  'slack',
  'whatsapp_business',
  'website',
] as const
export type tConnectionProvider = (typeof connectionProviders)[number]

// pending: being set up. active: working. broken: the provider refused our
// credentials or access (alerts fall back to email until it is reconnected).
// disconnected: the app was removed on the provider's side.
export const connectionStatuses = [
  'pending',
  'active',
  'broken',
  'disconnected',
] as const
export type tConnectionStatus = (typeof connectionStatuses)[number]

export interface iConnectionSettings {
  /** The Slack workspace name, for Channels. */
  accountName?: string | null
  /** Our bot's user id there, to spot @mentions of it. */
  botUserId?: string | null
  /** Where alerts go; null sends them to each linked member directly. */
  alertsChannelId?: string | null
  alertsChannelName?: string | null
  /** WhatsApp Business: the WhatsApp Business Account the number is in. */
  businessAccountId?: string | null
  /** WhatsApp Business: the number as customers see it. */
  displayPhoneNumber?: string | null
  /**
   * WhatsApp Business: an approved template with one body variable ({{1}})
   * for replies after the 24-hour window. Without one, those replies wait
   * for the owner as a draft.
   */
  templateName?: string | null
  templateLanguage?: string | null
}

export const connection = pgTable(
  'connection',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: connectionProviders }).notNull(),
    status: text('status', { enum: connectionStatuses })
      .notNull()
      .default('active'),
    // Slack team id, WhatsApp phone number id, the website's origin.
    externalAccountId: text('external_account_id').notNull(),
    // The workspace's AI, which talks there.
    assistantId: text('assistant_id').references(() => assistant.id, {
      onDelete: 'set null',
    }),
    // AES-GCM encrypted JSON (services/connections/credentials.ts), e.g.
    // Slack's bot token, WhatsApp's access token. Never returned to a
    // client or logged.
    credentialsEncrypted: text('credentials_encrypted'),
    settings: jsonb('settings')
      .$type<iConnectionSettings>()
      .notNull()
      .default({}),
    connectedByMemberId: text('connected_by_member_id').references(
      () => member.id,
      { onDelete: 'set null' },
    ),
    lastError: text('last_error'),
    lastSyncAt: timestamp('last_sync_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('connection_provider_account_idx')
      .on(table.provider, table.externalAccountId)
      .where(sql`${table.provider} <> 'website'`),
    // A website is one channel per workspace; two workspaces may share one.
    uniqueIndex('connection_website_origin_idx')
      .on(table.organizationId, table.externalAccountId)
      .where(sql`${table.provider} = 'website'`),
    index('connection_organization_idx').on(table.organizationId),
  ],
)

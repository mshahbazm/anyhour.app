import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { member } from '../auth/member'
import { connection } from './connection'

// A person in a Slack workspace, and the team member they
// linked through a one-time "Link your account" link. Until memberId is set
// the AI answers them with that link only.
export const connectionMember = pgTable(
  'connection_member',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    // Slack user id.
    externalUserId: text('external_user_id').notNull(),
    memberId: text('member_id').references(() => member.id, {
      onDelete: 'cascade',
    }),
    // Their direct-message channel with our bot, once opened.
    dmChannelId: text('dm_channel_id'),
    // sha256 of the one-time link token; cleared once used.
    linkTokenHash: text('link_token_hash'),
    linkExpiresAt: timestamp('link_expires_at'),
    linkedAt: timestamp('linked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('connection_member_external_idx').on(
      table.connectionId,
      table.externalUserId,
    ),
    uniqueIndex('connection_member_token_idx').on(table.linkTokenHash),
    index('connection_member_member_idx').on(table.memberId),
  ],
)

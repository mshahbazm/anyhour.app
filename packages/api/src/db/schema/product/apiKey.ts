import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { member } from '../auth/member'
import { organization } from '../auth/organization'

// A workspace API key. Only its SHA-256 hash is stored; the key is shown once.
export const apiKey = pgTable(
  'api_key',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    // First 12 characters, so owners can tell keys apart.
    keyPrefix: text('key_prefix').notNull(),
    createdByMemberId: text('created_by_member_id').references(
      () => member.id,
      { onDelete: 'set null' },
    ),
    lastUsedAt: timestamp('last_used_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('api_key_organization_idx').on(table.organizationId),
    uniqueIndex('api_key_hash_unique').on(table.keyHash),
  ],
)

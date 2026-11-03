import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { organization } from '../auth/organization'
import {
  memberRuleKinds,
  memberRuleTags,
} from '../../../config/memberRules.config'

// How the workspace's AI behaves in a conversation
// (config/memberRules.config.ts).
export const memberRule = pgTable(
  'member_rule',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: memberRuleKinds }).notNull(),
    tag: text('tag', { enum: memberRuleTags }),
    // The rule, or the steps' short title.
    text: text('text').notNull(),
    // Steps only: "When someone wants to book a visit".
    when: text('when'),
    // Steps only, in order.
    steps: jsonb('steps').$type<string[]>(),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('member_rule_org_position_idx').on(
      table.organizationId,
      table.position,
    ),
  ],
)

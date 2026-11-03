import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  vector,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { searchLanguage, searchVector } from './searchVector'
import { organization } from '../auth/organization'
import { knowledgeSource } from './knowledgeSource'

export const knowledgeSharedBlock = pgTable(
  'knowledge_shared_block',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    websiteId: text('website_id')
      .notNull()
      .references(() => knowledgeSource.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    embedding: vector('embedding', { dimensions: 384 }).notNull(),
    searchVector: searchVector('search_vector').generatedAlwaysAs(
      (): SQL =>
        sql`to_tsvector(${sql.raw(`'${searchLanguage}'`)}, ${knowledgeSharedBlock.text})`,
    ),
    embeddingModel: text('embedding_model').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('knowledge_shared_block_website_idx').on(table.websiteId),
    index('knowledge_shared_block_organization_idx').on(table.organizationId),
    index('knowledge_shared_block_search_idx').using('gin', table.searchVector),
  ],
)
export const knowledgeSharedBlockSource = pgTable(
  'knowledge_shared_block_source',
  {
    blockId: text('block_id')
      .notNull()
      .references(() => knowledgeSharedBlock.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => knowledgeSource.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.blockId, table.sourceId] }),
    index('knowledge_shared_block_source_source_idx').on(table.sourceId),
  ],
)

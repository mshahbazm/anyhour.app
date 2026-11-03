import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { searchLanguage, searchVector } from './searchVector'
import { organization } from '../auth/organization'
import { knowledgeSource } from './knowledgeSource'

export const knowledgeChunk = pgTable(
  'knowledge_chunk',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    sourceId: text('source_id')
      .notNull()
      .references(() => knowledgeSource.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind', { enum: ['content', 'pageProfile'] })
      .notNull()
      .default('content'),
    text: text('text').notNull(),
    embedding: vector('embedding', { dimensions: 384 }).notNull(),
    searchVector: searchVector('search_vector').generatedAlwaysAs(
      (): SQL =>
        sql`to_tsvector(${sql.raw(`'${searchLanguage}'`)}, ${knowledgeChunk.text})`,
    ),
    embeddingModel: text('embedding_model').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('knowledge_chunk_organization_idx').on(table.organizationId),
    index('knowledge_chunk_search_idx').using('gin', table.searchVector),
    uniqueIndex('knowledge_chunk_source_position_unique').on(
      table.sourceId,
      table.position,
    ),
  ],
)

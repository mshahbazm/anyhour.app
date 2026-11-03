import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organization } from '../auth/organization'
import { knowledgeSource } from './knowledgeSource'

export const indexRun = pgTable(
  'index_run',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    targetSourceId: text('target_source_id').references(
      () => knowledgeSource.id,
      { onDelete: 'set null' },
    ),
    trigger: text('trigger', {
      enum: ['created', 'manual', 'scheduled'],
    }).notNull(),
    status: text('status', {
      enum: ['queued', 'running', 'completed', 'failed'],
    })
      .notNull()
      .default('queued'),
    phase: text('phase', {
      enum: ['queued', 'crawling', 'preparing', 'embedding', 'completed'],
    })
      .notNull()
      .default('queued'),
    crawlProvider: text('crawl_provider', { enum: ['browser', 'http'] }),
    crawlWarning: text('crawl_warning'),
    crawlJobId: text('crawl_job_id'),
    crawlCursor: text('crawl_cursor'),
    crawlCollectedAt: timestamp('crawl_collected_at'),
    nextCrawlCheckAt: timestamp('next_crawl_check_at'),
    crawlLeaseUntil: timestamp('crawl_lease_until'),
    cleanupLeaseUntil: timestamp('cleanup_lease_until'),
    cleanupAttempts: integer('cleanup_attempts').notNull().default(0),
    discoveredCount: integer('discovered_count').notNull().default(0),
    fetchedCount: integer('fetched_count').notNull().default(0),
    unchangedCount: integer('unchanged_count').notNull().default(0),
    indexedCount: integer('indexed_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    errorSummary: text('error_summary'),
  },
  (table) => [
    index('index_run_organization_idx').on(table.organizationId),
    uniqueIndex('index_run_one_active_per_source')
      .on(table.targetSourceId)
      .where(sql`${table.status} in ('queued', 'running')`),
  ],
)

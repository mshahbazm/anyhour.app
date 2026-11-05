import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organization } from '../auth/organization'
import type { iPageProfile } from '../../../services/knowledge/cleanup/types'
import type { iScopePlan } from '../../../services/knowledge/scopeRules'

export const knowledgeSource = pgTable(
  'knowledge_source',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Every source belongs to the workspace: Your business.
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id),
    parentId: text('parent_id').references(
      (): AnyPgColumn => knowledgeSource.id,
    ),
    kind: text('kind', {
      enum: [
        'website',
        'webPage',
        'publicDocument',
        'upload',
        // A fact the owner taught in chat; its text lives in cleanedText.
        'note',
        'youtubeVideo',
        'youtubePlaylist',
        'youtubeChannel',
      ],
    }).notNull(),
    inputUrl: text('input_url'),
    canonicalUrl: text('canonical_url'),
    evidenceUrl: text('evidence_url'),
    objectKey: text('object_key'),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    fileSize: integer('file_size'),
    title: text('title'),
    includePaths: jsonb('include_paths')
      .$type<string[]>()
      .notNull()
      .default([]),
    excludePaths: jsonb('exclude_paths')
      .$type<string[]>()
      .notNull()
      .default([]),
    // Website only: the exclude rules added before its first read (articles
    // and listings). Null until planned; planned once, never on refreshes.
    scopePlan: jsonb('scope_plan').$type<iScopePlan>(),
    isPinned: boolean('is_pinned').notNull().default(false),
    isIncluded: boolean('is_included').notNull().default(true),
    discoveredVia: text('discovered_via', {
      // note: facts the owner typed in chat, kept editable in place; reply:
      // a note saved from a person's answer to a customer ("answers learned").
      enum: ['manual', 'sitemap', 'link', 'upload', 'note', 'reply'],
    }),
    depth: integer('depth'),
    cleanedText: text('cleaned_text'),
    pageProfile: jsonb('page_profile').$type<iPageProfile>(),
    pageActions: jsonb('page_actions')
      .$type<{ label: string; url: string }[]>()
      .notNull()
      .default([]),
    cleanupStatus: text('cleanup_status', { enum: ['complete', 'incomplete'] }),
    cleanupStats: jsonb('cleanup_stats').$type<{
      model: string
      attempts: number
      activeMs: number
      inputTokens: number
      outputTokens: number
      reason?: string
    }>(),
    contentHash: text('content_hash'),
    // What the last read served, before cleanup (pageReading.md): the same
    // hash on the next read skips cleanup, the profile and embeddings.
    readHash: text('read_hash'),
    cleanedCharCount: integer('cleaned_char_count'),
    status: text('status', {
      enum: [
        'pending',
        'ready',
        'failed',
        'excluded',
        'unsupported',
        'archived',
      ],
    })
      .notNull()
      .default('pending'),
    lastAttemptStatus: text('last_attempt_status', {
      enum: ['pending', 'running', 'unchanged', 'indexed', 'failed'],
    }),
    etag: text('etag'),
    lastModifiedHeader: text('last_modified_header'),
    lastSeenAt: timestamp('last_seen_at'),
    lastCheckedAt: timestamp('last_checked_at'),
    resultStartedAt: timestamp('result_started_at'),
    lastIndexedAt: timestamp('last_indexed_at'),
    lastError: text('last_error'),
    archivedAt: timestamp('archived_at'),
    deleteAfter: timestamp('delete_after'),
    nextArchiveCheckAt: timestamp('next_archive_check_at'),
    contentDeletedAt: timestamp('content_deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('knowledge_source_archive_check_idx').on(table.nextArchiveCheckAt),
    index('knowledge_source_organization_parent_idx').on(
      table.organizationId,
      table.parentId,
    ),
    uniqueIndex('knowledge_source_organization_url_unique').on(
      table.organizationId,
      table.canonicalUrl,
    ),
  ],
)

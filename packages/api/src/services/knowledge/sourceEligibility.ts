import { and, eq, isNull, sql } from 'drizzle-orm'
import { knowledgeSource } from '../../db/schema'

export function searchableSource() {
  const requestedPath = sql`coalesce(substring(${knowledgeSource.canonicalUrl} from '^https?://[^/]+(/[^?#]*)'), '/')`
  const evidencePath = sql`coalesce(substring(coalesce(${knowledgeSource.evidenceUrl}, ${knowledgeSource.canonicalUrl}) from '^https?://[^/]+(/[^?#]*)'), '/')`
  const outsidePaths = (path: typeof requestedPath) => sql`(
    (jsonb_array_length(parent.include_paths)>0 and not exists(select 1 from jsonb_array_elements_text(parent.include_paths) allowed(path) where left(${path},length(allowed.path))=allowed.path)) or
    exists(select 1 from jsonb_array_elements_text(parent.exclude_paths) blocked(path) where left(${path},length(blocked.path))=blocked.path)
  )`
  return and(
    eq(knowledgeSource.status, 'ready'),
    isNull(knowledgeSource.archivedAt),
    eq(knowledgeSource.isIncluded, true),
    sql`not exists (
    select 1 from knowledge_source parent where parent.id = ${
      knowledgeSource.parentId
    } and parent.kind = 'website' and (
      parent.is_included = false or
      ${outsidePaths(requestedPath)} or ${outsidePaths(evidencePath)}
    ))`,
  )
}

// Sources that hold answers themselves (a website root only groups its pages).
// A bot with at least one of these, searchable, has something to answer from.
export const answerableKinds = [
  'webPage',
  'upload',
  'publicDocument',
  'note',
] as const

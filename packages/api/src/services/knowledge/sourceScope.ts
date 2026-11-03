import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { knowledgeSource } from '../../db/schema'
import type { iPageScope } from './pageScope'

export async function sourceScope(
  source: typeof knowledgeSource.$inferSelect,
): Promise<iPageScope> {
  // A child refreshed by itself still belongs to its website's scope.
  let root = source
  if (source.parentId) {
    const [parent] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, source.parentId))
      .limit(1)
    if (parent?.kind === 'website') root = parent
  }
  const inputUrl = root.inputUrl ?? root.canonicalUrl
  if (!inputUrl) throw new Error('Page URL is missing')
  return {
    inputUrl,
    includePaths: root.kind === 'website' ? root.includePaths : [],
    excludePaths: root.kind === 'website' ? root.excludePaths : [],
  }
}

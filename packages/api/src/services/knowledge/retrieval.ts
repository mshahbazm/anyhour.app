import {
  aliasedTable,
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  inArray,
  sql,
} from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '../../db'
import {
  knowledgeChunk,
  knowledgeCorrection,
  knowledgeSource,
  knowledgeSharedBlock,
  knowledgeSharedBlockSource,
} from '../../db/schema'
import { embedTexts } from './embedding'
import { embeddingUsageRecorder } from './embeddingUsage'
import { profileChunkActions } from './profileChunk'
import { searchableSource } from './sourceEligibility'
import { searchLanguage } from '../../db/schema/product/searchVector'
import { ownedBy } from './owner'
import type { iKnowledgeOwner } from './owner'

type tPassageOrigin = 'owner' | 'website'

const ownerFactBoost = 0.05
// Each search contributes its best few candidates; fusion keeps the top five.
const candidatesPerSearch = 10
const passageCount = 5
// The usual reciprocal-rank-fusion constant: rank matters, raw scores don't.
const fusionK = 60

interface iCandidate {
  key: string
  /** That search's own score: distance (lower is closer) or keyword rank. */
  score: number
  sourceId: string
  url: string | null
  title: string | null
  text: string
  origin: tPassageOrigin
}

// Words of the question joined by OR (stemmed, stop words removed), so one
// distinctive term like "blog" or "Emma" can find a passage on its own.
function keywordQuery(question: string) {
  return sql`nullif(replace(plainto_tsquery(${sql.raw(`'${searchLanguage}'`)}, ${question})::text, ' & ', ' | '), '')::tsquery`
}

const originOf = sql<tPassageOrigin>`case when ${knowledgeSource.kind} = 'note' then 'owner' else 'website' end`

// Hybrid retrieval: meaning (vector) and exact words (full text) each rank
// candidates, and reciprocal rank fusion merges the two lists. Vector search
// alone misses exact terms such as product names, plans and prices.
export async function searchKnowledge(
  assistantId: string,
  organizationId: string,
  /** Null when not searching for a visitor, e.g. checking knowledge gaps. */
  conversationId: string | null,
  question: string,
  signal?: AbortSignal,
  /** Content passages to return; more gives a reranker room to choose. */
  count = passageCount,
) {
  const { vectors } = await embedTexts([question], {
    signal,
    onUsage: embeddingUsageRecorder({
      organizationId,
      assistantId,
      ...(conversationId ? { conversationId } : {}),
    }),
  })
  const vector = vectors[0]
  const reader = { organizationId }
  const distance = cosineDistance(knowledgeChunk.embedding, vector).mapWith(
    Number,
  )
  // Facts the owner typed outrank equally close website text, so a correction
  // reaches the top results even while the website still says otherwise.
  const ranked =
    sql<number>`(${distance}) - case when ${knowledgeSource.kind} = 'note' then ${sql.raw(String(ownerFactBoost))}::float8 else 0 end`.mapWith(
      Number,
    )
  const query = keywordQuery(question)
  const keywordRank = sql<number>`ts_rank_cd(${knowledgeChunk.searchVector}, ${query})`
  const chunkFields = {
    key: sql<string>`'chunk:' || ${knowledgeChunk.id}`,
    sourceId: knowledgeSource.id,
    url: knowledgeSource.canonicalUrl,
    title: knowledgeSource.title,
    text: knowledgeChunk.text,
    origin: originOf,
  }
  const contentChunks = (score: SQL<number>) =>
    db
      .select({ ...chunkFields, score: score.mapWith(Number) })
      .from(knowledgeChunk)
      .innerJoin(
        knowledgeSource,
        eq(knowledgeChunk.sourceId, knowledgeSource.id),
      )
  const contentWhere = and(
    ownedBy(knowledgeChunk, reader),
    eq(knowledgeChunk.kind, 'content'),
    ownedBy(knowledgeSource, reader),
    searchableSource(),
  )
  // Give navigation its own small result budget so content passages cannot
  // crowd out a page whose purpose matches the visitor's request.
  const profilesQuery = db
    .select({
      sourceId: knowledgeSource.id,
      url: knowledgeSource.canonicalUrl,
      title: knowledgeSource.title,
      text: knowledgeChunk.text,
      actions: knowledgeSource.pageActions,
    })
    .from(knowledgeChunk)
    .innerJoin(knowledgeSource, eq(knowledgeChunk.sourceId, knowledgeSource.id))
    .where(
      and(
        ownedBy(knowledgeChunk, reader),
        ownedBy(knowledgeSource, reader),
        eq(knowledgeChunk.kind, 'pageProfile'),
        searchableSource(),
      ),
    )
    .orderBy(asc(distance), asc(knowledgeSource.id))
    .limit(2)
  const [vectorChunks, keywordChunks, vectorShared, keywordShared, profiles] =
    await Promise.all([
      contentChunks(ranked)
        .where(contentWhere)
        .orderBy(asc(ranked))
        .limit(Math.max(count, candidatesPerSearch)),
      contentChunks(keywordRank)
        .where(
          and(contentWhere, sql`${knowledgeChunk.searchVector} @@ ${query}`),
        )
        .orderBy(desc(keywordRank))
        .limit(Math.max(count, candidatesPerSearch)),
      searchSharedContent(reader, {
        by: 'meaning',
        order: cosineDistance(knowledgeSharedBlock.embedding, vector),
      }),
      searchSharedContent(reader, {
        by: 'words',
        query,
        order: sql`ts_rank_cd(${knowledgeSharedBlock.searchVector}, ${query})`,
      }),
      profilesQuery,
    ])
  // Chunks and shared blocks merge into one list per search: closest
  // meaning first, and most matching words first.
  const byMeaning = [...vectorChunks, ...vectorShared].sort(
    (a, b) => a.score - b.score,
  )
  const byWords = [...keywordChunks, ...keywordShared].sort(
    (a, b) => b.score - a.score,
  )
  const fused = fuse([byMeaning, byWords]).slice(0, count)
  const corrected = await ownerCorrections(
    reader,
    fused
      .filter((item) => item.origin === 'website')
      .map((item) => item.sourceId),
  )
  const passages = fused.map((item) => ({
    sourceId: item.sourceId,
    url: item.url,
    title: item.title,
    text: item.text,
    origin: item.origin,
    kind: 'content' as const,
    actions: [] as Array<{ label: string; url: string }>,
    // The owner told the bot something this page contradicts: say so right
    // on the passage, so the model can't weigh it against their word.
    ...(corrected.has(item.sourceId)
      ? { outdated: corrected.get(item.sourceId)! }
      : {}),
  }))
  return [
    ...passages,
    ...profiles.map((item) => ({
      ...item,
      origin: 'website' as const,
      kind: 'pageProfile' as const,
      actions: profileChunkActions(item.text, item.actions),
    })),
  ]
}

// Website passages the owner knowingly overrode, with what they said instead.
async function ownerCorrections(reader: iKnowledgeOwner, sourceIds: string[]) {
  const corrected = new Map<
    string,
    Array<{ pageSaid: string; ownerSays: string }>
  >()
  if (!sourceIds.length) return corrected
  const note = aliasedTable(knowledgeSource, 'note')
  const rows = await db
    .select({
      sourceId: knowledgeCorrection.sourceId,
      pageSaid: knowledgeCorrection.excerpt,
      ownerSays: note.cleanedText,
    })
    .from(knowledgeCorrection)
    .innerJoin(note, eq(note.id, knowledgeCorrection.noteId))
    .where(
      and(
        ownedBy(knowledgeCorrection, reader),
        inArray(knowledgeCorrection.sourceId, sourceIds),
        inArray(knowledgeCorrection.status, ['active', 'needsReview']),
      ),
    )
  for (const row of rows)
    corrected.set(row.sourceId, [
      ...(corrected.get(row.sourceId) ?? []),
      { pageSaid: row.pageSaid, ownerSays: row.ownerSays ?? '' },
    ])
  return corrected
}

// Reciprocal rank fusion: a passage near the top of either list scores well,
// and one both searches agree on scores best.
function fuse(lists: iCandidate[][]) {
  const fused = new Map<string, { item: iCandidate; total: number }>()
  for (const list of lists)
    list.forEach((item, rank) => {
      const entry = fused.get(item.key) ?? { item, total: 0 }
      entry.total += 1 / (fusionK + rank + 1)
      fused.set(item.key, entry)
    })
  return [...fused.values()]
    .sort((a, b) => b.total - a.total)
    .map((entry) => entry.item)
}

async function searchSharedContent(
  reader: iKnowledgeOwner,
  search:
    { by: 'meaning'; order: SQL } | { by: 'words'; query: SQL; order: SQL },
) {
  const order = search.order.mapWith(Number)
  // DISTINCT ON selects a live, permitted source before the result limit; deleted/disabled origins cannot hide surviving ones.
  const candidates = db
    .selectDistinctOn([knowledgeSharedBlock.id], {
      key: sql<string>`'shared:' || ${knowledgeSharedBlock.id}`.as('key'),
      sourceId: sql<string>`${knowledgeSource.id}`.as('source_id'),
      url: knowledgeSource.canonicalUrl,
      title: knowledgeSource.title,
      text: knowledgeSharedBlock.text,
      origin: sql<tPassageOrigin>`'website'`.as('origin'),
      score: order.as('score'),
    })
    .from(knowledgeSharedBlock)
    .innerJoin(
      knowledgeSharedBlockSource,
      eq(knowledgeSharedBlockSource.blockId, knowledgeSharedBlock.id),
    )
    .innerJoin(
      knowledgeSource,
      eq(knowledgeSource.id, knowledgeSharedBlockSource.sourceId),
    )
    .where(
      and(
        ownedBy(knowledgeSharedBlock, reader),
        ownedBy(knowledgeSource, reader),
        searchableSource(),
        search.by === 'words'
          ? sql`${knowledgeSharedBlock.searchVector} @@ ${search.query}`
          : undefined,
      ),
    )
    .orderBy(knowledgeSharedBlock.id, knowledgeSource.id)
    .as('sharedCandidates')
  const rows = await db
    .select()
    .from(candidates)
    .orderBy(
      search.by === 'meaning' ? asc(candidates.score) : desc(candidates.score),
    )
    .limit(candidatesPerSearch)
  return rows
}

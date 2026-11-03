import type { searchKnowledge } from '../knowledge/retrieval'

export type tKnowledgePassage = Awaited<
  ReturnType<typeof searchKnowledge>
>[number]

// A retrieved passage as the model reads it: the visitor chat's search tool
// and the handoff reply suggestion both use this shape. Both reach
// customers, so a passage with no public address (an uploaded file or a note)
// never carries the owner's file name or note title.
export function modelPassage(item: tKnowledgePassage) {
  return {
    sourceId: item.sourceId,
    url: item.url,
    title: item.url
      ? item.title
      : item.origin === 'owner'
        ? 'What the business told us'
        : 'A document from the business',
    text: item.text,
    kind: item.kind,
    origin: item.origin,
    ...(item.actions.length ? { actions: item.actions } : {}),
    ...('outdated' in item ? { outdated: item.outdated } : {}),
  }
}

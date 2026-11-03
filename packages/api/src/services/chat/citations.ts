import { normalizeUrl } from '../knowledge/web'

export interface iCitation {
  sourceId: string
  url: string | null
  title: string | null
}

// Retrieval registers candidates; only explicit answer evidence selects citations.
export function createCitationSelection() {
  const candidates = new Map<string, iCitation>()
  let selected: iCitation[] = []
  return {
    register(items: iCitation[]) {
      for (const { sourceId, url, title } of items)
        candidates.set(sourceId, { sourceId, url, title })
    },
    select(sourceIds: string[]) {
      const ids = [...new Set(sourceIds)]
      if (ids.some((id) => !candidates.has(id)))
        return {
          accepted: false,
          error: 'Only retrieved source IDs may be cited.',
        }
      selected = ids.map((id) => candidates.get(id)!)
      return { accepted: true }
    },
    // A site can serve one page at several addresses ("/" and "/index.html");
    // show each page once.
    get citations() {
      const seen = new Set<string>()
      return selected.filter((item) => {
        let key = item.sourceId
        if (item.url)
          try {
            const url = new URL(normalizeUrl(item.url))
            url.search = ''
            key = `${url.host}${url.pathname.replace(/\/$/, '')}`
          } catch {
            key = item.url
          }
        const titled = item.title
          ? `${key.split('/')[0]}|${item.title.trim().toLowerCase()}`
          : null
        if (seen.has(key) || (titled && seen.has(titled))) return false
        seen.add(key)
        if (titled) seen.add(titled)
        return true
      })
    },
  }
}

// Visitors only see sources they can open. Notes and uploaded files have no
// public address, and their names are the owner's internal labels.
export function visitorCitations<T extends { url: string | null }>(
  citations: T[] | null,
) {
  return (citations ?? []).filter((item) => Boolean(item.url))
}

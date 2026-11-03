import { knowledgeOverviewLimits as limits } from '../../../config/knowledgeOverview.config'
import type { iPageProfile } from '../cleanup/types'

export interface iOverviewSource {
  id: string
  parentId: string | null
  kind: string
  title: string | null
  fileName: string | null
  url: string | null
  inputUrl: string | null
  contentHash: string | null
  profile: iPageProfile | null
  /** Only read for notes and home pages. */
  text: string | null
}

export interface iOverviewInput {
  /** Compact text the model reads. Identical text means nothing changed. */
  text: string
  /** Links the model may use for actions; anything else is dropped. */
  actions: { label: string; url: string }[]
  /** Websites and documents, named for the owner. */
  sources: string[]
}

function host(url: string | null) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : null
  } catch {
    return null
  }
}

function path(url: string | null) {
  try {
    return url ? new URL(url).pathname.replace(/\/(index\.html?)?$/, '') : ''
  } catch {
    return ''
  }
}

function name(source: iOverviewSource) {
  return source.title ?? source.fileName ?? 'Untitled'
}

// Home page first, then shallow pages, then pages with things to do.
function rank(page: iOverviewSource) {
  const depth = path(page.url).split('/').filter(Boolean).length
  const actions = page.profile?.actions.length ? 0 : 1
  return depth * 10 + actions
}

function profileLine(source: iOverviewSource) {
  const profile = source.profile
  if (!profile) return null
  const where = source.url ? ` (${path(source.url) || '/'})` : ''
  const parts = [`- ${name(source)}${where}: ${profile.summary}`]
  if (profile.topics.length) parts.push(`Topics: ${profile.topics.join(', ')}.`)
  if (profile.actions.length)
    parts.push(
      `Actions: ${profile.actions.map((action) => action.label).join(', ')}.`,
    )
  return parts.join(' ')
}

// Pages that are the same page at several addresses share their content.
function distinct(pages: iOverviewSource[]) {
  const seen = new Set<string>()
  return pages.filter((page) => {
    const key = page.contentHash ?? `${name(page)}|${page.profile?.summary}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Picks a bounded set of profiles and notes from everything a bot learned,
// so the overview costs the same however much knowledge there is.
export function buildOverviewInput(
  sources: iOverviewSource[],
): iOverviewInput | null {
  const notes = sources.filter((source) => source.kind === 'note')
  const websites = sources.filter(
    (source) => source.kind === 'website' && !source.parentId,
  )
  const documents = distinct(
    sources.filter(
      (source) =>
        source.profile &&
        source.kind !== 'note' &&
        !websites.some((site) => site.id === source.parentId),
    ),
  ).slice(0, limits.documents)
  const pagesBySite = websites.map((site) => ({
    site,
    pages: distinct(
      sources
        .filter((source) => source.parentId === site.id && source.profile)
        .sort((a, b) => rank(a) - rank(b)),
    ),
  }))

  // Websites share what's left after documents, in proportion to their size.
  const budget = Math.max(0, limits.profiles - documents.length)
  const total = pagesBySite.reduce((sum, item) => sum + item.pages.length, 0)
  const sections: string[] = []
  const actions = new Map<string, { label: string; url: string }>()
  const collect = (source: iOverviewSource) => {
    for (const action of source.profile?.actions ?? [])
      // Hosting artefacts like Cloudflare's hidden email links aren't actions.
      if (!action.url.includes('/cdn-cgi/')) actions.set(action.url, action)
  }

  for (const { site, pages } of pagesBySite) {
    if (!pages.length) continue
    const share = Math.max(
      limits.minProfilesPerWebsite,
      Math.round((budget * pages.length) / Math.max(1, total)),
    )
    const chosen = pages.slice(0, share)
    const home = chosen[0]
    const lines = [
      `## Website ${host(site.inputUrl) ?? name(site)} (${pages.length} pages)`,
    ]
    if (home?.text)
      lines.push(
        `Home page text: ${home.text.replace(/\s+/g, ' ').slice(0, limits.homepageTextChars)}`,
      )
    for (const page of chosen) {
      const line = profileLine(page)
      if (line) lines.push(line)
      collect(page)
    }
    const others = pages.slice(share, share + limits.otherTitles).map(name)
    if (others.length)
      lines.push(`Other pages: ${[...new Set(others)].join('; ')}`)
    sections.push(lines.join('\n'))
  }

  if (documents.length) {
    const lines = ['## Documents and single pages']
    for (const document of documents) {
      const line = profileLine(document)
      if (line) lines.push(line)
      collect(document)
    }
    sections.push(lines.join('\n'))
  }

  let noteBudget: number = limits.noteChars
  const noteLines: string[] = []
  for (const note of notes) {
    const text = (note.text ?? '').trim()
    if (!text || noteBudget <= 0) continue
    noteLines.push(text.slice(0, noteBudget))
    noteBudget -= text.length
  }
  if (noteLines.length)
    sections.push(`## Facts the owner taught\n${noteLines.join('\n\n')}`)

  if (!sections.length) return null
  return {
    text: sections.join('\n\n'),
    actions: [...actions.values()],
    sources: [
      ...websites.map((site) => host(site.inputUrl) ?? name(site)),
      ...documents.map(name),
      ...(notes.length ? ['Facts you taught in chat'] : []),
    ],
  }
}

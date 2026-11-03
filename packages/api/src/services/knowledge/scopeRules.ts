import { ruleMatches } from './web'

// Which parts of a website are worth learning, decided once before its first
// read. Articles (blog posts, guides, news, insights) and listings (tag,
// category, author, date and page-number archives) add cost and noise and
// help the AI with nothing, and copies of the site in other languages
// repeat it, so they become ordinary exclude rules the owner can remove. Pure functions here; scopePlan.ts does the fetching.

export type tPathKind =
  'business' | 'article' | 'listing' | 'language' | 'other'
export type tSkippedKind = 'article' | 'listing' | 'language'

export interface iScopeRule {
  rule: string
  kind: tSkippedKind
  /** Known pages the rule skipped when it was added. */
  pages: number
}

/** Rules the planner added to a website's exclude rules, kept as a record. */
export interface iScopePlan {
  plannedAt: string
  rules: iScopeRule[]
}

export interface iKnownPage {
  path: string
  /** File name of the sitemap that listed it, e.g. "post-sitemap.xml". */
  sitemap?: string
}

/**
 * Pages under one first path segment ("/insights"), or one top-level page
 * on its own ("/about"), which may be a post on a WordPress-style site.
 */
export interface iPathGroup {
  path: string
  single: boolean
  paths: string[]
  sitemaps: string[]
}

export const maxExactRules = 1000

const listingSegments = new Set([
  'tag',
  'tags',
  'category',
  'categories',
  'author',
  'authors',
  'page',
])
const sitemapWords: Record<string, tPathKind> = {
  category: 'listing',
  categories: 'listing',
  cat: 'listing',
  tag: 'listing',
  tags: 'listing',
  author: 'listing',
  users: 'listing',
  archive: 'listing',
  post: 'article',
  posts: 'article',
  blog: 'article',
  news: 'article',
  article: 'article',
  articles: 'article',
  page: 'business',
  pages: 'business',
  product: 'business',
  products: 'business',
  service: 'business',
  services: 'business',
  location: 'business',
  locations: 'business',
  portfolio: 'business',
  project: 'business',
  projects: 'business',
}

// The last telling word wins: "wp-sitemap-posts-page-1.xml" lists pages,
// "post_tag-sitemap.xml" lists tag archives.
export function sitemapKind(name: string | undefined) {
  if (!name) return undefined
  const words = name
    .toLowerCase()
    .replace(/\.xml(?:\.gz)?$/, '')
    .split(/[^a-z]+/)
  return words
    .map((word) => sitemapWords[word])
    .filter(Boolean)
    .at(-1)
}

export function groupPages(pages: iKnownPage[]) {
  const folders = new Map<string, iPathGroup>()
  const top: iKnownPage[] = []
  for (const page of pages) {
    const segments = page.path.split('/').filter(Boolean)
    if (!segments.length) continue
    if (segments.length === 1) {
      top.push(page)
      continue
    }
    const path = `/${segments[0]}`
    const group = folders.get(path) ?? {
      path,
      single: false,
      paths: [],
      sitemaps: [],
    }
    group.paths.push(page.path)
    if (page.sitemap) group.sitemaps.push(page.sitemap)
    folders.set(path, group)
  }
  const singles: iPathGroup[] = []
  for (const page of top) {
    const path = `/${page.path.split('/').filter(Boolean)[0]}`
    const folder = folders.get(path)
    // A folder's own address is its index page, part of the folder.
    if (folder) {
      folder.paths.push(page.path)
      continue
    }
    singles.push({
      path,
      single: true,
      paths: [page.path],
      sitemaps: page.sitemap ? [page.sitemap] : [],
    })
  }
  return [
    ...[...folders.values()].sort((a, b) => b.paths.length - a.paths.length),
    ...singles,
  ]
}

// What a group is from evidence that costs nothing: its folder name when it
// can only be an archive, dated addresses, the sitemap that lists it, and
// the site's feed (which only lists articles).
export function freeDecision(
  group: iPathGroup,
  feedPaths: Set<string>,
): tPathKind | undefined {
  const segment = group.path.slice(1).toLowerCase()
  if (!group.single && listingSegments.has(segment)) return 'listing'
  if (!group.single && /^(?:19|20)\d{2}$/.test(segment)) return 'article'
  const inFeed = group.paths.filter((path) => feedPaths.has(path)).length
  if (group.single ? inFeed === 1 : inFeed >= Math.min(2, group.paths.length))
    return 'article'
  if (group.sitemaps.length === group.paths.length) {
    const kinds = group.sitemaps.map(sitemapKind)
    for (const kind of ['listing', 'article', 'business'] as const)
      if (
        kinds.filter((value) => value === kind).length >=
        Math.ceil(group.paths.length * 0.8)
      )
        return kind
  }
  return undefined
}

const languageNames = new Intl.DisplayNames(['en'], {
  type: 'language',
  fallback: 'none',
})
// Language codes that are far more often ordinary folders ("/my/account").
const notLanguages = new Set(['my', 'in', 'co'])

function folderLanguage(group: iPathGroup) {
  const code = group.path.slice(1).toLowerCase()
  if (group.single || !/^[a-z]{2}(?:-[a-z]{2})?$/.test(code)) return undefined
  const language = code.slice(0, 2)
  if (notLanguages.has(language)) return undefined
  try {
    return languageNames.of(code) ? language : undefined
  } catch {
    return undefined
  }
}

/**
 * Folders that are the site in another language ("/es", "/de-de"). The
 * home page's language (its `lang`, e.g. "en-US") is never skipped, and
 * nothing is when language folders are all the site has.
 */
export function languageFolders(groups: iPathGroup[], homeLang?: string) {
  const home = homeLang?.slice(0, 2).toLowerCase()
  const folders = groups.flatMap((group) => {
    const language = folderLanguage(group)
    return language ? [{ path: group.path, language }] : []
  })
  const isHome = (language: string) => language === home
  const otherContent =
    folders.length < groups.length ||
    folders.some(({ language }) => isHome(language))
  if (!otherContent) return []
  return folders
    .filter(({ language }) => !isHome(language))
    .map(({ path }) => path)
}

// Tag, category, author and page-number archives inside a folder the site
// keeps ("/shop/category/shoes", "/news/page/2").
export function nestedListingRules(paths: string[]) {
  const rules = new Set<string>()
  for (const path of paths) {
    const segments = path.split('/').filter(Boolean)
    const index = segments.findIndex(
      (segment, position) =>
        position > 0 &&
        position < segments.length - 1 &&
        listingSegments.has(segment.toLowerCase()),
    )
    if (index > 0) rules.add(`/${segments.slice(0, index + 1).join('/')}/`)
  }
  return [...rules]
}

/**
 * Exclude rules for the groups decided as articles or listings: a prefix rule
 * for a folder (its index page is a listing, so it goes too), a "this page
 * only" rule for a top-level page. Rules already in `existing` are not added
 * again, and each rule counts the known pages it skips.
 */
export function scopeRules(
  groups: iPathGroup[],
  decisions: Map<string, tPathKind>,
  existing: string[],
) {
  const candidates: Array<{ rule: string; kind: tSkippedKind }> = []
  let exact = 0
  for (const group of groups) {
    const kind = decisions.get(group.path)
    if (kind !== 'article' && kind !== 'listing' && kind !== 'language')
      continue
    // "/de/" and not "/de": that would also skip "/delivery".
    if (kind === 'language') candidates.push({ rule: `${group.path}/`, kind })
    else if (group.single) {
      if (exact++ >= maxExactRules) continue
      candidates.push({ rule: `${group.path}$`, kind })
    } else candidates.push({ rule: group.path, kind })
  }
  const allPaths = groups.flatMap((group) => group.paths)
  const covered = (path: string, rules: string[]) =>
    rules.some((rule) => ruleMatches(path, rule))
  const folderRules = [...existing, ...candidates.map(({ rule }) => rule)]
  for (const rule of nestedListingRules(
    allPaths.filter((path) => !covered(path, folderRules)),
  ))
    candidates.push({ rule, kind: 'listing' })
  const rules: iScopeRule[] = []
  for (const candidate of candidates) {
    if (existing.includes(candidate.rule)) continue
    const before = [...existing, ...rules.map(({ rule }) => rule)]
    const pages = allPaths.filter(
      (path) =>
        ruleMatches(path, candidate.rule) &&
        // Pages an earlier rule already skips count once.
        !covered(path, before),
    ).length
    if (pages) rules.push({ ...candidate, pages })
  }
  return rules
}

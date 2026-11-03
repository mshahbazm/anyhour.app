import { expect, test } from 'bun:test'
import {
  freeDecision,
  groupPages,
  languageFolders,
  scopeRules,
  sitemapKind,
  type tPathKind,
} from '../../src/services/knowledge/scopeRules'
import { pathAllowed } from '../../src/services/knowledge/web'

test('an exact rule skips one page, a prefix rule a whole folder', () => {
  const site = 'https://shop.example'
  const excludes = ['/my-post$', '/insights']
  expect(pathAllowed(`${site}/my-post`, [], excludes)).toBe(false)
  expect(pathAllowed(`${site}/my-post/`, [], excludes)).toBe(false)
  expect(pathAllowed(`${site}/my-post-two`, [], excludes)).toBe(true)
  expect(pathAllowed(`${site}/my-post/comments`, [], excludes)).toBe(true)
  expect(pathAllowed(`${site}/insights`, [], excludes)).toBe(false)
  expect(pathAllowed(`${site}/insights/a`, [], excludes)).toBe(false)
  expect(pathAllowed(`${site}/services`, ['/services$'], [])).toBe(true)
  expect(pathAllowed(`${site}/services/a`, ['/services$'], [])).toBe(false)
})

test('sitemap names say what they list', () => {
  expect(sitemapKind('post-sitemap.xml')).toBe('article')
  expect(sitemapKind('post_tag-sitemap.xml')).toBe('listing')
  expect(sitemapKind('wp-sitemap-posts-page-1.xml')).toBe('business')
  expect(sitemapKind('wp-sitemap-taxonomies-category-1.xml')).toBe('listing')
  expect(sitemapKind('product-sitemap.xml')).toBe('business')
  expect(sitemapKind('sitemap.xml')).toBeUndefined()
})

test('free evidence turns articles and listings into exclude rules', () => {
  const insights = Array.from({ length: 20 }, (_, i) => `/insights/post-${i}`)
  const groups = groupPages([
    { path: '/' },
    { path: '/about' },
    { path: '/services' },
    { path: '/services/cleaning' },
    { path: '/services/category/home' },
    { path: '/insights' },
    ...insights.map((path) => ({ path })),
    { path: '/tag/tips' },
    { path: '/tag/news' },
    { path: '/2024/05/old-news' },
    { path: '/spring-sale-recap', sitemap: 'post-sitemap.xml' },
    { path: '/winter-tips' },
  ])
  // The folder index joins its folder; the home page is never grouped.
  expect(groups.find((g) => g.path === '/insights')?.paths).toHaveLength(21)
  expect(groups.find((g) => g.path === '/services')?.single).toBe(false)
  expect(groups.some((g) => g.path === '/')).toBe(false)

  const feed = new Set(['/insights/post-1', '/insights/post-2', '/winter-tips'])
  const decisions = new Map<string, tPathKind>()
  for (const group of groups) {
    const kind = freeDecision(group, feed)
    if (kind) decisions.set(group.path, kind)
  }
  expect(Object.fromEntries(decisions)).toEqual({
    '/insights': 'article',
    '/tag': 'listing',
    '/2024': 'article',
    '/spring-sale-recap': 'article',
    '/winter-tips': 'article',
  })
  expect(decisions.has('/about')).toBe(false)
  expect(decisions.has('/services')).toBe(false)

  const rules = scopeRules(groups, decisions, ['/2024'])
  expect(rules).toEqual([
    { rule: '/insights', kind: 'article', pages: 21 },
    { rule: '/tag', kind: 'listing', pages: 2 },
    { rule: '/spring-sale-recap$', kind: 'article', pages: 1 },
    { rule: '/winter-tips$', kind: 'article', pages: 1 },
    // An archive inside a folder that stays.
    { rule: '/services/category/', kind: 'listing', pages: 1 },
  ])
})

test('copies of the site in other languages are skipped', () => {
  const groups = groupPages([
    { path: '/about' },
    { path: '/services/cleaning' },
    { path: '/services/repairs' },
    { path: '/es' },
    { path: '/es/servicios' },
    { path: '/de-de/leistungen' },
    { path: '/en-gb/services' },
    // Not languages: an account area and a code that names none.
    { path: '/my/account' },
    { path: '/us/stores' },
  ])
  expect(languageFolders(groups, 'en-US').sort()).toEqual(['/de-de', '/es'])
  // Without the home page's language, English copies are skipped too.
  expect(languageFolders(groups).sort()).toEqual(['/de-de', '/en-gb', '/es'])

  const decisions = new Map<string, tPathKind>(
    languageFolders(groups, 'en').map((path) => [path, 'language']),
  )
  // "/es/" and not "/es": the Spanish home page is read, "/escape" too.
  expect(scopeRules(groups, decisions, [])).toEqual([
    { rule: '/es/', kind: 'language', pages: 1 },
    { rule: '/de-de/', kind: 'language', pages: 1 },
  ])
  expect(pathAllowed('https://shop.example/escape', [], ['/es/'])).toBe(true)

  // A site that is only language folders keeps them all, unless the home
  // page says which one is its own.
  const onlyLanguages = groupPages([
    { path: '/en/about' },
    { path: '/fr/a-propos' },
  ])
  expect(languageFolders(onlyLanguages)).toEqual([])
  expect(languageFolders(onlyLanguages, 'en')).toEqual(['/fr'])
})

import { describe, expect, test } from 'bun:test'
import { buildOverviewInput } from '../../src/services/knowledge/overview/overviewInput'
import type { iOverviewSource } from '../../src/services/knowledge/overview/overviewInput'

function source(overrides: Partial<iOverviewSource>): iOverviewSource {
  return {
    id: crypto.randomUUID(),
    parentId: null,
    kind: 'webPage',
    title: null,
    fileName: null,
    url: null,
    inputUrl: null,
    contentHash: null,
    profile: null,
    text: null,
    ...overrides,
  }
}

const profile = (
  summary: string,
  actions: { label: string; url: string }[] = [],
) => ({
  summary,
  purposes: [],
  topics: ['websites'],
  visitorGoals: [],
  actions,
})

describe('knowledge overview input', () => {
  test('reads websites, documents and notes alike, once per page', () => {
    const site = source({ kind: 'website', inputUrl: 'https://shop.example/' })
    const pages = [
      source({
        parentId: site.id,
        title: 'Home',
        url: 'https://shop.example/',
        contentHash: 'home',
        profile: profile('A bike shop.'),
        text: 'Bikes for every rider.',
      }),
      // The same page at another address counts once.
      source({
        parentId: site.id,
        title: 'Home',
        url: 'https://shop.example/index.html',
        contentHash: 'home',
        profile: profile('A bike shop.'),
      }),
      source({
        parentId: site.id,
        title: 'Book a repair',
        url: 'https://shop.example/repairs/book',
        contentHash: 'book',
        profile: profile('Repairs booking.', [
          { label: 'Book', url: 'https://shop.example/repairs/book' },
        ]),
      }),
    ]
    const menu = source({
      kind: 'upload',
      fileName: 'price-list.pdf',
      contentHash: 'pdf',
      profile: profile('Repair prices.'),
    })
    const note = source({
      kind: 'note',
      title: 'Hours',
      text: '# Hours\n\nOpen 9–5.',
    })
    const input = buildOverviewInput([site, ...pages, menu, note])
    expect(input?.text.match(/A bike shop\./g)).toHaveLength(1)
    expect(input?.text).toContain('Home page text: Bikes for every rider.')
    expect(input?.text).toContain('Repair prices.')
    expect(input?.text).toContain('Open 9–5.')
    expect(input?.actions).toEqual([
      { label: 'Book', url: 'https://shop.example/repairs/book' },
    ])
    expect(input?.sources).toEqual([
      'shop.example',
      'price-list.pdf',
      'Facts you taught in chat',
    ])
  })

  test('a huge site costs the same as a small one', () => {
    const site = source({ kind: 'website', inputUrl: 'https://big.example/' })
    const pages = Array.from({ length: 2000 }, (_, i) =>
      source({
        parentId: site.id,
        title: `Page ${i}`,
        url: `https://big.example/section/page-${i}`,
        contentHash: `page${i}`,
        profile: profile(`Page ${i} summary.`),
      }),
    )
    const input = buildOverviewInput([site, ...pages])
    expect(input?.text.match(/summary\./g)?.length).toBe(40)
    expect(input?.text.length).toBeLessThan(12_000)
  })

  test('nothing learned yet means no overview', () => {
    expect(buildOverviewInput([])).toBeNull()
  })
})

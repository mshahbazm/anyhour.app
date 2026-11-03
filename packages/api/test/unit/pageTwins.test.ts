import { describe, expect, test } from 'bun:test'
import {
  areTwinPages,
  preferredPage,
  twinPrefix,
} from '../../src/services/knowledge/pageTwins'

describe('page twins', () => {
  test('treats .html and clean addresses as one page', () => {
    expect(
      areTwinPages('https://a.com/terms', 'https://a.com/terms.html'),
    ).toBe(true)
    expect(
      preferredPage('https://a.com/terms.html', 'https://a.com/terms'),
    ).toBe('https://a.com/terms')
  })

  test('treats a query variant as a copy of its plain page', () => {
    const plain = 'https://a.com/start.html'
    const variant = 'https://a.com/start.html?package=mia'
    expect(areTwinPages(plain, variant)).toBe(true)
    expect(preferredPage(variant, plain)).toBe(plain)
  })

  test('keeps pages that differ only by query apart', () => {
    expect(
      areTwinPages('https://a.com/item?id=1', 'https://a.com/item?id=2'),
    ).toBe(false)
  })

  test('keeps different paths apart', () => {
    expect(
      areTwinPages('https://a.com/terms', 'https://a.com/terms-of-sale'),
    ).toBe(false)
    expect(twinPrefix('https://a.com/terms.html')).toBe('https://a.com/terms')
  })
})

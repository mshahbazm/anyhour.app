import { describe, expect, test } from 'bun:test'
import { assertPageScope } from '../../src/services/knowledge/pageScope'
import { pathAllowed } from '../../src/services/knowledge/web'

describe('resolved page evidence scope', () => {
  const website = {
    inputUrl: 'https://example.com',
    includePaths: ['/services'],
    excludePaths: ['/services/private'],
  }

  test('rejects excluded and out-of-scope redirect destinations', () => {
    expect(() =>
      assertPageScope(website, 'https://example.com/services/alias'),
    ).not.toThrow()
    expect(() =>
      assertPageScope(website, 'https://example.com/services/private/pricing'),
    ).toThrow('path settings')
    expect(() => assertPageScope(website, 'https://example.com/admin')).toThrow(
      'path settings',
    )
    expect(() =>
      assertPageScope(website, 'https://other.example/services'),
    ).toThrow('outside the website')
  })

  test('accepts same-website aliases but rejects protocol downgrades and credentials', () => {
    expect(() =>
      assertPageScope(website, 'https://www.example.com/services/book/'),
    ).not.toThrow()
    expect(() =>
      assertPageScope(website, 'http://example.com/services'),
    ).toThrow('outside the website')
    expect(() =>
      assertPageScope(website, 'https://user:secret@example.com/services'),
    ).toThrow('credentials')
  })
})

test('hosting-provider machinery is never treated as a page', () => {
  expect(
    pathAllowed('https://shop.example/cdn-cgi/l/email-protection', [], []),
  ).toBe(false)
  expect(pathAllowed('https://shop.example/contact', [], [])).toBe(true)
})

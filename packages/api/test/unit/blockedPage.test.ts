import { expect, test } from 'bun:test'
import { isBlockedPage } from '../../src/services/knowledge/pageLoaders/blocked'

test('bot-protection pages are not content', () => {
  const page = (title: string, body = '<p>Hello</p>') =>
    `<html><head><title>${title}</title></head><body>${body}</body></html>`
  expect(isBlockedPage(page('Just a moment...'))).toBe(true)
  expect(isBlockedPage(page('Attention Required! | Cloudflare'))).toBe(true)
  expect(isBlockedPage(page('Access Denied'))).toBe(true)
  expect(isBlockedPage(page('Access to this page has been denied'))).toBe(true)
  expect(isBlockedPage(page('Access to www.example.com was denied'))).toBe(true)
  expect(isBlockedPage(page('ERROR: The request could not be satisfied'))).toBe(
    true,
  )
  // A short refusal with a 403, but not a short page that loaded.
  expect(isBlockedPage(page('Forbidden', '<p>Nope.</p>'), 403)).toBe(true)
  expect(isBlockedPage(page('Contact us', '<p>Call us.</p>'), 200)).toBe(false)
  expect(
    isBlockedPage(
      page('Our services', `<p>${'Plumbing. '.repeat(200)}</p>`),
      403,
    ),
  ).toBe(false)
})

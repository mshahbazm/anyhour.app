import { expect, test } from 'bun:test'
import {
  isBlockedPage,
  judgeResponse,
} from '../../src/services/pageReading/content'
import type { iReaderResponse } from '../../src/services/pageReading/types'

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

const response = (
  html: string,
  status = 200,
  contentType = 'text/html',
): iReaderResponse => ({
  url: 'https://example.com/',
  status,
  contentType,
  content: { format: 'text', text: html },
  validators: { etag: null, lastModifiedHeader: null },
})
const body = (inner: string) =>
  `<html><head><title>Example</title></head><body>${inner}</body></html>`
const words = 'We fix leaking taps and boilers across town. '.repeat(10)

test('a read is judged before it counts as content', () => {
  expect(judgeResponse('page', response(body(`<p>${words}</p>`)))).toEqual({
    verdict: 'real',
  })
  // An app shell: scripts and an empty root, nothing to read yet.
  expect(
    judgeResponse(
      'page',
      response(body('<div id="root"></div><script>render()</script>')),
    ),
  ).toEqual({ verdict: 'thin' })
  // A cookie banner alone is not the page.
  expect(
    judgeResponse(
      'page',
      response(
        body(`<div class="cookie-banner"><p>${words}</p></div><main></main>`),
      ),
    ),
  ).toEqual({ verdict: 'thin' })
  // A body class naming cookies doesn't hide the page.
  expect(
    judgeResponse(
      'page',
      response(
        `<html><body class="cookies-accepted"><p>${words}</p></body></html>`,
      ),
    ),
  ).toEqual({ verdict: 'real' })
  expect(
    judgeResponse('page', response(body('<p>Just a moment</p>'), 404)),
  ).toEqual({ verdict: 'notFound', status: 404 })
  expect(
    judgeResponse(
      'page',
      response(
        '<html><head><title>Just a moment...</title></head><body></body></html>',
      ),
    ),
  ).toEqual({ verdict: 'blocked' })
  expect(judgeResponse('sitemap', response('', 429, 'text/plain'))).toEqual({
    verdict: 'blocked',
  })
  expect(judgeResponse('page', response(body(words), 500))).toEqual({
    verdict: 'failed',
    reason: 'Page returned HTTP 500',
  })
  // Short files are content: only web pages can be thin.
  expect(
    judgeResponse('sitemap', response('User-agent: *', 200, 'text/plain')),
  ).toEqual({ verdict: 'real' })
})

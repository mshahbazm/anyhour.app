import { describe, expect, test } from 'bun:test'
import { extractPageBlocks } from '../../src/services/knowledge/cleanup/extractBlocks'
import {
  contentHash,
  formatBlocks,
  isCurrentContentHash,
} from '../../src/services/knowledge/cleanup/formatBlocks'
import { groupRepeatedBlocks } from '../../src/services/knowledge/cleanup/repeatedBlocks'
import {
  makeCleanupRequest,
  planCleanupRequests,
} from '../../src/services/knowledge/cleanup/cleanupRequests'
import { chunkText } from '../../src/services/knowledge/chunk'
import { inspectHtml } from '../../src/services/knowledge/web'

const page = { url: 'https://example.com/services', title: 'Services' }
const extract = (html: string) => extractPageBlocks({ ...page, html }).blocks

describe('action link evidence', () => {
  test('relative actions and discovery use the document directory and base href', () => {
    const html = '<base href="../appointments/"><a href="book">Book</a>'
    const url = 'https://example.com/services/repairs/'
    expect(
      extractPageBlocks({ html, url, title: 'Repairs' }).blocks[0].links[0].url,
    ).toBe('https://example.com/services/appointments/book')
    expect(inspectHtml(html, url).links).toEqual([
      'https://example.com/services/appointments/book',
    ])
  })

  test('identical labels keep their own URLs, context, query parameters and fragments', () => {
    const text = formatBlocks(
      extract(
        '<h2>Repairs</h2><p>Urgent: <a href="/book?type=urgent&amp;branch=1#slots">Book now</a>. Routine: <a href="/book?type=routine">Book now</a>.</p>',
      ),
    )
    expect(text).toContain(
      'Urgent: [Book now](<https://example.com/book?type=urgent&amp;branch=1#slots>)',
    )
    expect(text).toContain(
      'Routine: [Book now](<https://example.com/book?type=routine>)',
    )
    expect(text).toContain('Repairs')
  })

  test('nested card anchors, inline emphasis, image alt and accessible labels retain destinations', () => {
    const text = formatBlocks(
      extract(
        '<a href="/repair"><div><h2>Repair</h2><p>Book <strong>today</strong></p></div></a><a href="/photo"><img alt="View gallery"></a><a href="/contact" aria-label="Contact us"><svg></svg><img alt=" "> </a>',
      ),
    )
    expect(text).toContain('[Repair](<https://example.com/repair>)')
    expect(text).toContain('[Book today](<https://example.com/repair>)')
    expect(text).toContain('[View gallery](<https://example.com/photo>)')
    expect(text).toContain('[Contact us](<https://example.com/contact>)')
  })

  test('uses document base and preserves phone/email links while escaping literal Markdown', () => {
    const text = formatBlocks(
      extract(
        '<head><base href="https://book.example/path/"></head><body><a href="reserve(1)?a=2#step">Book [now]</a><a href="tel:+441234">Call</a><a href="mailto:team@example.com">Email</a><a href="javascript:alert(1)">Bad</a><p>[Fake](https://invented.example)</p></body>',
      ),
    )
    expect(text).toContain(
      '[Book \\[now\\]](<https://book.example/path/reserve(1)?a=2#step>)',
    )
    expect(text).toContain('[Call](<tel:+441234>)')
    expect(text).toContain('[Email](<mailto:team@example.com>)')
    expect(text).not.toContain('javascript:')
    expect(text).toContain('\\[Fake\\](https://invented.example)')
  })

  test('literal entities, image markers and backslashes do not change link meaning', () => {
    const text = formatBlocks(
      extract(
        '<p>!<a href="mailto:team@example.com?subject=a\\*b&amp;amp;copy;=yes">&amp;copy;</a></p>',
      ),
    )
    expect(text).toContain('\\!')
    expect(text).toContain(
      '[&amp;copy;](<mailto:team@example.com?subject=a\\\\*b&amp;amp;copy;=yes>)',
    )
  })

  test('shared links remain searchable text; equal labels with distinct destinations remain separate', () => {
    const first = extract('<footer><a href="/book">Book</a></footer>')
    const second = extract(
      '<footer class="active"><a href="/book">Book</a></footer>',
    )
    const third = extract('<footer><a href="/other">Book</a></footer>')
    const groups = groupRepeatedBlocks([
      { sourceId: 'a', blocks: first },
      { sourceId: 'b', blocks: second },
      { sourceId: 'c', blocks: third },
    ])
    expect(groups.get('a')?.shared[0].text).toBe(
      '[Book](<https://example.com/book>)',
    )
    expect(groups.get('c')?.specific).toHaveLength(1)
    expect(groups.get('c')?.shared).toHaveLength(0)
    expect(contentHash(page.title, formatBlocks(first))).not.toBe(
      contentHash(page.title, formatBlocks(third)),
    )
    expect(
      isCurrentContentHash(contentHash(page.title, formatBlocks(first))),
    ).toBe(true)
    expect(isCurrentContentHash('old-text-only-hash')).toBe(false)
  })

  test('the decision provider sees original text and links without duplicate formatting metadata', () => {
    const blocks = extract('<p>Please <a href="/book">book now</a>.</p>')
    const { jobs } = planCleanupRequests(page, blocks)
    const request = makeCleanupRequest(page, jobs[0])
    expect(request.input.blocks[0].text).toBe('Please book now .')
    expect(request.input.blocks[0].links[0].url).toBe(
      'https://example.com/book',
    )
    expect(request.input.blocks[0]).not.toHaveProperty('inlineParts')
  })
})

describe('link-preserving chunks', () => {
  test('long unmatched brackets stay ordinary text instead of failing indexing', () => {
    for (const value of [
      '[' + 'literal '.repeat(5000),
      '['.repeat(40_000),
      '[label](' + 'literal'.repeat(7000),
      '[label](<'.repeat(5000),
    ]) {
      const chunks = chunkText(value, 'Page')
      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.every((chunk) => Buffer.byteLength(chunk) <= 6000)).toBe(
        true,
      )
    }
    const valid = `[${'label'.repeat(7000)}](<https://example.com/book>)`
    expect(() => chunkText(valid, 'Page')).toThrow('cannot be truncated')
  })

  test('Markdown link titles and escaped brackets are kept with their destination', () => {
    for (const link of [
      '[Booking form]( <https://example.com/book> )',
      '[Booking form](https://example.com/book "Open (booking) form")',
      "[Booking form](<https://example.com/book(1)> 'Open booking form')",
    ]) {
      const chunks = chunkText(
        `${'Before '.repeat(299)}${link} ${'After '.repeat(100)}`,
        'Services',
      )
      expect(chunks.some((chunk) => chunk.includes(link))).toBe(true)
      for (const chunk of chunks.filter((value) =>
        value.includes('example.com'),
      ))
        expect(chunk).toContain(link)
    }
  })
  test('links stay whole across size boundaries and overlap', () => {
    const link =
      '[Book a repair \\[today\\]](<https://booking.example/reserve(1)?branch=2#slots>)'
    const text = `${'Intro '.repeat(299)}${link} ${'After '.repeat(400)}`
    const chunks = chunkText(text, 'Repairs')
    expect(chunks.length).toBeGreaterThan(1)
    const linked = chunks.filter((chunk) => chunk.includes('booking.example'))
    expect(linked.length).toBeGreaterThan(0)
    for (const chunk of linked) expect(chunk).toContain(link)
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(6000)
      if (chunk.includes('[Book')) expect(chunk).toContain(link)
    }
  })

  test('existing Markdown and Unicode remain intact; oversized URLs fail explicitly', () => {
    const link = '[予約](https://example.com/book(a)?type=1#slots)'
    const chunks = chunkText(`${'漢字𠮷'.repeat(900)} ${link}`, '予約')
    expect(chunks.some((chunk) => chunk.includes(link))).toBe(true)
    expect(
      chunks.every(
        (chunk) => Buffer.byteLength(chunk) <= 6000 && !chunk.includes('�'),
      ),
    ).toBe(true)
    expect(() =>
      chunkText(`[Book](<https://example.com/${'x'.repeat(6000)}>)`, 'Page'),
    ).toThrow('cannot be truncated')
  })
})

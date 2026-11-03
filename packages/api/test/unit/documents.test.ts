import { describe, expect, test } from 'bun:test'
import {
  detectDocumentFormat,
  DocumentUnreadableError,
  extractDocumentText,
  unreadableReason,
} from '../../src/services/knowledge/documents'

const encode = (text: string) => new TextEncoder().encode(text)

describe('document format detection', () => {
  test('trusts signatures over declared types', () => {
    const pdf = encode('%PDF-1.7 …')
    expect(detectDocumentFormat({ bytes: pdf, mimeType: 'text/plain' })).toBe(
      'pdf',
    )
    expect(
      detectDocumentFormat({ bytes: encode('hello'), fileName: 'fake.pdf' }),
    ).toBeNull()
    expect(
      detectDocumentFormat({ bytes: encode('hello'), fileName: 'notes.docx' }),
    ).toBeNull()
  })

  test('uses MIME type, then extension, and rejects binary text files', () => {
    expect(
      detectDocumentFormat({
        bytes: encode('a,b'),
        mimeType: 'text/csv; charset=utf-8',
      }),
    ).toBe('csv')
    expect(
      detectDocumentFormat({ bytes: encode('# Hi'), fileName: 'README.md' }),
    ).toBe('markdown')
    expect(
      detectDocumentFormat({
        bytes: new Uint8Array([104, 0, 105]),
        fileName: 'notes.txt',
      }),
    ).toBeNull()
    expect(
      detectDocumentFormat({ bytes: encode('x'), fileName: 'image.png' }),
    ).toBeNull()
  })
})

describe('unreadable files', () => {
  test('give a reason the owner can act on', () => {
    const reason = (fileName: string, bytes = new Uint8Array([1, 2, 3])) =>
      unreadableReason({ bytes, fileName })
    expect(reason('menu.doc')).toContain('.docx or PDF')
    expect(reason('prices.xlsx')).toContain('CSV')
    expect(reason('deck.pptx')).toContain('PDF')
    expect(reason('photo.JPG')).toContain('Images')
    expect(reason('https://site.com/menu.pdf?v=2')).toContain(
      'isn’t a valid PDF',
    )
    expect(reason('data.bin')).toContain('Supported files')
  })

  test('UTF-16 text is read, not rejected as binary', async () => {
    const bytes = new Uint8Array([
      0xff,
      0xfe,
      ...Buffer.from('Price: £200', 'utf16le'),
    ])
    const format = detectDocumentFormat({ bytes, fileName: 'notes.txt' })
    expect(format).toBe('text')
    expect(await extractDocumentText(bytes, format!)).toBe('Price: £200')
  })
})

describe('document text extraction', () => {
  test('turns CSV rows into labelled lines, including quoted cells', async () => {
    const text = await extractDocumentText(
      encode('Service,Price\n"Cut, wash",30\nColour,\n'),
      'csv',
    )
    expect(text).toBe('Service: Cut, wash; Price: 30\n\nService: Colour')
  })

  test('reads HTML as text blocks without scripts', async () => {
    const text = await extractDocumentText(
      encode(
        '<html><head><title>Hours</title><script>alert(1)</script></head><body><main><h1>Opening hours</h1><p>Open 9 to 5.</p></main></body></html>',
      ),
      'html',
    )
    expect(text).toContain('Open 9 to 5.')
    expect(text).not.toContain('alert')
  })

  test('sanitizes control characters and rejects empty documents', async () => {
    expect(
      await extractDocumentText(encode('a\u0000b\r\n\n\n\nc'), 'text'),
    ).toBe('ab\n\nc')
    expect(extractDocumentText(encode(' \n '), 'text')).rejects.toBeInstanceOf(
      DocumentUnreadableError,
    )
  })
})

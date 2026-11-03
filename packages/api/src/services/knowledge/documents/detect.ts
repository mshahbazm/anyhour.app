import { documentFormats, supportedDocumentLabels } from './formats'
import type { tDocumentFormat } from './formats'

const entries = Object.entries(documentFormats) as Array<
  [tDocumentFormat, (typeof documentFormats)[tDocumentFormat]]
>

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value)
}

// Declared types and names can lie; binary formats must also match their signature.
export function detectDocumentFormat(input: {
  bytes: Uint8Array
  mimeType?: string | null
  fileName?: string | null
}): tDocumentFormat | null {
  const mime = input.mimeType?.split(';', 1)[0].trim().toLowerCase() ?? ''
  const extension = extensionOf(input.fileName)
  const declared =
    entries.find(([, format]) =>
      (format.mimeTypes as readonly string[]).includes(mime),
    )?.[0] ??
    entries.find(([, format]) =>
      (format.extensions as readonly string[]).includes(extension),
    )?.[0] ??
    null
  const isPdf = startsWith(input.bytes, [0x25, 0x50, 0x44, 0x46])
  const isZip = startsWith(input.bytes, [0x50, 0x4b, 0x03, 0x04])
  if (isPdf) return 'pdf'
  if (declared === 'pdf') return null
  if (declared === 'docx') return isZip ? 'docx' : null
  // Text formats must not be binary (UTF-16 text legitimately holds zero bytes).
  if (
    declared &&
    !isUtf16(input.bytes) &&
    input.bytes.subarray(0, 4096).includes(0)
  )
    return null
  return declared
}

// "menu.PDF" and "https://site/menu.pdf?v=2" both end in "pdf".
function extensionOf(name: string | null | undefined) {
  const last = name?.split(/[?#]/, 1)[0].split('/').pop() ?? ''
  return last.includes('.') ? (last.split('.').pop()?.toLowerCase() ?? '') : ''
}

// Windows "Unicode" text and some spreadsheet CSV exports are UTF-16.
export function isUtf16(bytes: Uint8Array) {
  return startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])
}

const advice: Array<[string[], string]> = [
  [
    ['doc'],
    'Old Word documents (.doc) can’t be read reliably. Save it as .docx or PDF and add that instead.',
  ],
  [
    ['rtf', 'odt', 'pages', 'wpd'],
    'This document format can’t be read. Save it as Word (.docx) or PDF and add that instead.',
  ],
  [
    ['xls', 'xlsx', 'xlsm', 'ods', 'numbers'],
    'Spreadsheets can’t be read directly. Export the sheet as CSV and add that instead.',
  ],
  [
    ['ppt', 'pptx', 'odp', 'key'],
    'Presentations can’t be read directly. Export it as PDF and add that instead.',
  ],
  [
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'tif', 'tiff', 'svg'],
    'Images can’t be read. If it’s a scanned document, save it as a PDF and add that instead.',
  ],
  [
    ['zip', 'rar', '7z', 'gz'],
    'Compressed folders can’t be read. Unzip it and add the files inside.',
  ],
]

// Why a file couldn't be read, in words the owner can act on.
export function unreadableReason(input: {
  bytes: Uint8Array
  mimeType?: string | null
  fileName?: string | null
}) {
  const extension = extensionOf(input.fileName)
  const known = advice.find(([extensions]) => extensions.includes(extension))
  if (known) return known[1]
  if (extension === 'pdf')
    return 'This file is named .pdf but isn’t a valid PDF. It may be damaged; try exporting it again.'
  if (extension === 'docx')
    return 'This file is named .docx but isn’t a valid Word document. It may be damaged; try saving it again.'
  const textFormat = Object.values(documentFormats).find((format) =>
    (format.extensions as readonly string[]).includes(extension),
  )
  if (textFormat)
    return `This file is named .${extension} but holds binary data, not text.`
  return `This file type can’t be read. Supported files: ${supportedDocumentLabels}.`
}

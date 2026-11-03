// Document formats the knowledge base can read, from uploads or public URLs.
export const documentFormats = {
  pdf: {
    label: 'PDF',
    mimeTypes: ['application/pdf'],
    extensions: ['pdf'],
  },
  docx: {
    label: 'Word (.docx)',
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    extensions: ['docx'],
  },
  markdown: {
    label: 'Markdown',
    mimeTypes: ['text/markdown', 'text/x-markdown'],
    extensions: ['md', 'markdown'],
  },
  text: {
    label: 'Text',
    mimeTypes: ['text/plain'],
    extensions: ['txt', 'text'],
  },
  csv: {
    label: 'CSV',
    mimeTypes: ['text/csv', 'application/csv'],
    extensions: ['csv'],
  },
  html: {
    label: 'HTML',
    mimeTypes: ['text/html', 'application/xhtml+xml'],
    extensions: ['html', 'htm'],
  },
} as const

export type tDocumentFormat = keyof typeof documentFormats

export const supportedDocumentLabels = Object.values(documentFormats)
  .map((format) => format.label)
  .join(', ')

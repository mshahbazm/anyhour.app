import type { iKnowledgeSource } from '../workspace/types'

export type tSourceTone = 'success' | 'progress' | 'warning' | 'error' | 'muted'

export function sourceState(source: iKnowledgeSource): {
  label: string
  tone: tSourceTone
} {
  if (source.archivedAt) return { label: 'Archived', tone: 'muted' }
  if (!source.isIncluded) return { label: 'Excluded', tone: 'muted' }
  if (source.lastAttemptStatus === 'running')
    return { label: 'Indexing', tone: 'progress' }
  if (source.status === 'ready')
    return source.lastAttemptStatus === 'failed'
      ? { label: 'Refresh failed', tone: 'warning' }
      : { label: 'Ready', tone: 'success' }
  if (source.status === 'failed') return { label: 'Failed', tone: 'error' }
  if (source.status === 'unsupported')
    return { label: 'Unsupported', tone: 'warning' }
  if (source.status === 'excluded') return { label: 'Excluded', tone: 'muted' }
  return { label: 'Queued', tone: 'progress' }
}

export function sourceTitle(source: iKnowledgeSource) {
  return (
    source.title ||
    source.fileName ||
    displayUrl(source.inputUrl ?? source.canonicalUrl) ||
    'Untitled source'
  )
}

export function displayUrl(url: string | null) {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.hostname.replace(/^www\./, '')}${path}`
  } catch {
    return url
  }
}

export const kindLabels: Record<string, string> = {
  website: 'Website',
  webPage: 'Page',
  publicDocument: 'Document link',
  upload: 'Upload',
  note: 'Told in chat',
}

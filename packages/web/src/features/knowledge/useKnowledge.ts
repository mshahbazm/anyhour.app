import { useCallback, useEffect, useRef, useState } from 'react'
import { api, apiResponse } from '../workspace/api'
import type { iIndexingRun, iKnowledgeSource } from '../workspace/types'

export const uploadLimitBytes = 10 * 1024 * 1024
export const uploadAccept = '.pdf,.docx,.txt,.md,.markdown,.csv,.html,.htm'
export const uploadTypesLabel = 'PDF, Word (.docx), text, Markdown, CSV or HTML'

// The server decides what it can read and explains why when it can't; the
// browser only stops files that are too big to send.
export function validateUpload(file: File) {
  if (file.size > uploadLimitBytes)
    return `${file.name}: maximum file size is 10 MB`
  return null
}

export interface iUploadReport {
  added: string[]
  failed: Array<{ name: string; reason: string }>
}

// Each file is added on its own, so one unreadable file never blocks the rest.
export async function uploadFiles(
  base: string,
  files: File[],
): Promise<iUploadReport> {
  const report: iUploadReport = { added: [], failed: [] }
  for (const file of files) {
    const problem = validateUpload(file)
    if (problem) {
      report.failed.push({
        name: file.name,
        reason: 'Maximum file size is 10 MB',
      })
      continue
    }
    const data = new FormData()
    data.append('file', file)
    try {
      await apiResponse(`${base}/uploads`, { method: 'POST', body: data })
      report.added.push(file.name)
    } catch (cause) {
      report.failed.push({
        name: file.name,
        reason: cause instanceof Error ? cause.message : 'Upload failed',
      })
    }
  }
  return report
}

// One message naming each file that couldn't be added and why, or null.
export function uploadProblem(report: iUploadReport) {
  if (!report.failed.length) return null
  const files = report.failed.length === 1 ? 'file' : 'files'
  return `Couldn’t add ${report.failed.length} ${files} — ${report.failed
    .map((item) => `${item.name}: ${item.reason}`)
    .join(' · ')}`
}

export interface iKnowledgeState {
  sources: iKnowledgeSource[]
  runs: iIndexingRun[]
  indexing: boolean
  /** Work is waiting but the background service isn't running it. */
  paused: boolean
  loaded: boolean
  hasMore: boolean
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
}

// Keeps Your business's sources and their reading runs current. Polls only while reading.
export function useKnowledge(
  base: string | null,
  onError: (message: string) => void,
): iKnowledgeState {
  const [sources, setSources] = useState<iKnowledgeSource[]>([])
  const [runs, setRuns] = useState<iIndexingRun[]>([])
  const [indexing, setIndexing] = useState(false)
  const [paused, setPaused] = useState(false)
  const [loadedBase, setLoadedBase] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const activeBase = useRef(base)
  const paging = useRef({ base: '', pages: 1, version: 0 })
  activeBase.current = base

  const refresh = useCallback(async () => {
    if (!base) {
      setSources([])
      setRuns([])
      setCursor(null)
      setIndexing(false)
      setLoadedBase(null)
      return
    }
    if (paging.current.base !== base)
      paging.current = { base, pages: 1, version: 0 }
    const current = paging.current
    const version = ++current.version
    const [response, status] = await Promise.all([
      apiResponse(`${base}/sources?limit=100`),
      api<{
        ready: boolean
        indexing: boolean
        paused?: boolean
        runs: iIndexingRun[]
      }>(`${base}/status`),
    ])
    const rows = (await response.json()) as iKnowledgeSource[]
    let next = response.headers.get('X-Next-Cursor')
    for (let page = 1; page < current.pages && next; page++) {
      const more = await apiResponse(
        `${base}/sources?limit=100&cursor=${encodeURIComponent(next)}`,
      )
      rows.push(...((await more.json()) as iKnowledgeSource[]))
      next = more.headers.get('X-Next-Cursor')
    }
    if (activeBase.current !== base || current.version !== version) return
    setSources(rows)
    setCursor(next)
    setIndexing(status.indexing)
    setPaused(Boolean(status.paused))
    setRuns(status.runs)
    setLoadedBase(base)
  }, [base])

  const loadMore = useCallback(async () => {
    if (!base || !cursor) return
    const response = await apiResponse(
      `${base}/sources?limit=100&cursor=${encodeURIComponent(cursor)}`,
    )
    const rows = (await response.json()) as iKnowledgeSource[]
    if (activeBase.current !== base) return
    paging.current.pages++
    paging.current.version++
    setSources((previous) => [
      ...previous,
      ...rows.filter((row) => !previous.some((item) => item.id === row.id)),
    ])
    setCursor(response.headers.get('X-Next-Cursor'))
  }, [base, cursor])

  useEffect(() => {
    setSources([])
    setRuns([])
    setIndexing(false)
    void refresh().catch((cause) =>
      onError(
        cause instanceof Error ? cause.message : 'Could not load sources',
      ),
    )
  }, [refresh, onError])

  useEffect(() => {
    if (!base) return
    const update = () => {
      if (!document.hidden) void refresh().catch(() => undefined)
    }
    const interval = indexing ? window.setInterval(update, 4000) : undefined
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
    }
  }, [base, indexing, refresh])

  return {
    sources,
    runs,
    indexing,
    paused,
    loaded: Boolean(base) && loadedBase === base,
    hasMore: Boolean(cursor),
    refresh,
    loadMore,
  }
}

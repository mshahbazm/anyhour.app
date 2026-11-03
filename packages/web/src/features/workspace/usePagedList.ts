import { useCallback, useEffect, useRef, useState } from 'react'
import { apiResponse } from './api'

// Reads a cursor-paginated API collection (X-Next-Cursor) and refreshes on focus.
export function usePagedList<T extends { id: string }>(path: string | null) {
  const [items, setItems] = useState<T[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [error, setError] = useState('')
  const active = useRef(path)
  active.current = path

  const page = useCallback(
    async (after: string | null) => {
      if (!path) return null
      const separator = path.includes('?') ? '&' : '?'
      const response = await apiResponse(
        `${path}${separator}limit=50${after ? `&cursor=${encodeURIComponent(after)}` : ''}`,
      )
      const rows = (await response.json()) as T[]
      return { rows, next: response.headers.get('X-Next-Cursor') }
    },
    [path],
  )

  const refresh = useCallback(async () => {
    try {
      const result = await page(null)
      if (!result || active.current !== path) return
      setItems(result.rows)
      setCursor(result.next)
      setLoadedPath(path)
      setError('')
    } catch (cause) {
      if (active.current === path)
        setError(cause instanceof Error ? cause.message : 'Could not load')
    }
  }, [page, path])

  const loadMore = useCallback(async () => {
    if (!cursor) return
    const result = await page(cursor)
    if (!result || active.current !== path) return
    setItems((previous) => [
      ...previous,
      ...result.rows.filter(
        (row) => !previous.some((item) => item.id === row.id),
      ),
    ])
    setCursor(result.next)
  }, [cursor, page, path])

  useEffect(() => {
    setItems([])
    setCursor(null)
    void refresh()
    const update = () => {
      if (!document.hidden) void refresh()
    }
    window.addEventListener('focus', update)
    return () => window.removeEventListener('focus', update)
  }, [refresh])

  return {
    items,
    setItems,
    loaded: Boolean(path) && loadedPath === path,
    error,
    hasMore: Boolean(cursor),
    refresh,
    loadMore,
  }
}

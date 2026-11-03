import { useEffect, useState } from 'react'
import { api } from '../workspace/api'

export const ranges = [7, 30, 90] as const
export type tRange = (typeof ranges)[number]

export interface iInsightTotals {
  visitors: number
  views: number
  opens: number
  prompts: number
  conversations: number
  leads: number
}

export interface iInsightRow {
  value: string
  count: number
}

// Mirrors packages/api/src/services/insights/siteInsights.ts.
export interface iInsights {
  days: number
  hasVisits: boolean
  totals: iInsightTotals
  previous: iInsightTotals
  daily: Array<iInsightTotals & { day: string }>
  top: Record<
    'page' | 'source' | 'country' | 'device' | 'browser',
    iInsightRow[]
  >
}

// `tracking` reloads the numbers when visitor counts are switched.
export function useInsights(
  organizationId: string | null,
  botId: string | undefined,
  days: tRange,
  tracking: boolean,
) {
  const [insights, setInsights] = useState<iInsights | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!organizationId || !botId) return
    let current = true
    setError('')
    api<iInsights>(
      `/api/organizations/${organizationId}/assistants/${botId}/insights?days=${days}`,
    )
      .then((result) => {
        if (current) setInsights(result)
      })
      .catch((cause: unknown) => {
        if (current)
          setError(cause instanceof Error ? cause.message : 'Could not load')
      })
    return () => {
      current = false
    }
  }, [organizationId, botId, days, tracking])
  return { insights, error }
}

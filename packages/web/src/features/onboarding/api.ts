import { useCallback, useEffect, useState } from 'react'
import { api } from '../workspace/api'

/** The workspace as Settings edits it (GET/PATCH .../workspace). */
export interface iWorkspaceProfile {
  id: string
  name: string
  /** IANA name; opening hours are local to it. Null until set. */
  timeZone: string | null
}

/** The browser's time zone ("Europe/London"), when it reports one. */
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

function workspacePath(organizationId: string) {
  return `/api/organizations/${encodeURIComponent(organizationId)}/workspace`
}

/** Creates the user's workspace and its AI, reading the website if given. */
export function createWorkspace(input: {
  aiName?: string
  websiteUrl?: string
  organizationId?: string
}) {
  return api<{ organizationId: string; assistantId: string }>(
    '/api/workspaces',
    {
      method: 'POST',
      body: JSON.stringify({ ...input, timeZone: browserTimeZone() }),
    },
  )
}

export function saveWorkspaceProfile(
  organizationId: string,
  input: { name?: string; timeZone?: string },
) {
  return api<iWorkspaceProfile>(workspacePath(organizationId), {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

/**
 * The workspace's name, for Settings. A workspace without a time zone gets
 * the browser's, once, when an owner or admin opens it.
 */
export function useWorkspaceProfile(
  organizationId: string | null,
  canEdit: boolean,
) {
  const [state, setState] = useState<{
    id: string | null
    profile: iWorkspaceProfile | null
  }>({ id: null, profile: null })
  useEffect(() => {
    if (!organizationId) return
    let current = true
    api<iWorkspaceProfile>(workspacePath(organizationId))
      .then((profile) => current && setState({ id: organizationId, profile }))
      .catch(() => current && setState({ id: organizationId, profile: null }))
    return () => {
      current = false
    }
  }, [organizationId])
  const mine = state.id === organizationId
  const missingZone = mine && state.profile !== null && !state.profile.timeZone
  useEffect(() => {
    const timeZone = browserTimeZone()
    if (!organizationId || !canEdit || !missingZone || !timeZone) return
    saveWorkspaceProfile(organizationId, { timeZone })
      .then((profile) => setState({ id: organizationId, profile }))
      .catch(() => undefined)
  }, [organizationId, canEdit, missingZone])
  return {
    profile: mine ? state.profile : null,
    setProfile: useCallback(
      (profile: iWorkspaceProfile) => setState({ id: profile.id, profile }),
      [],
    ),
  }
}

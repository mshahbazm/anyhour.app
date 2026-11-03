import { useEffect, useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { ApiKeys } from '../channels/apiKeys'
import { problem } from '../workspace/api'
import { saveWorkspaceProfile } from './api'
import type { iWorkspaceProfile } from './api'
import './onboarding.css'

// Workspace settings: its name, and the API keys the WordPress plugin uses.
export function WorkspaceSettingsDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string | null
  canManage: boolean
  profile: iWorkspaceProfile | null
  onSaved: (profile: iWorkspaceProfile) => void
}) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const { open, profile } = props

  // Each opening starts from what's saved.
  useEffect(() => {
    if (!open || !profile) return
    setName(profile.name)
    setError('')
  }, [open, profile])

  async function save() {
    if (!props.organizationId) return
    if (!name.trim()) {
      setError('Give your workspace a name.')
      return
    }
    setPending(true)
    setError('')
    try {
      props.onSaved(
        await saveWorkspaceProfile(props.organizationId, { name: name.trim() }),
      )
      props.onOpenChange(false)
    } catch (cause) {
      setError(problem(cause, 'Could not save. Please try again.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent className="settingsDialog">
        <DialogHeader>
          <DialogTitle>Workspace settings</DialogTitle>
        </DialogHeader>
        <form
          className="settingsForm"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            if (!pending) void save()
          }}
        >
          <div className="askField">
            <label htmlFor="settingsName">Workspace name</label>
            <input
              id="settingsName"
              className="askInput"
              value={name}
              maxLength={120}
              disabled={pending || !profile}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {error && (
            <p className="inlineError" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !profile}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
        {props.organizationId && open && (
          <ApiKeys
            organizationId={props.organizationId}
            canManage={props.canManage}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

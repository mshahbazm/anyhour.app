import { Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { problem } from '../workspace/api'
import { formatWhen } from '../workspace/formatWhen'
import { createApiKey, deleteApiKey, listApiKeys } from './api'
import type { iApiKey } from './api'
import './channels.css'

function ApiKeyRow(props: {
  apiKey: iApiKey
  organizationId: string
  canManage: boolean
  onDeleted: (id: string) => void
}) {
  const { apiKey } = props
  const [confirm, setConfirm] = useState(false)
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState('')
  return (
    <li className="connectionRow">
      <div className="connectionText">
        <strong>{apiKey.name}</strong>
        <small>
          <code>{apiKey.keyPrefix}…</code> ·{' '}
          {apiKey.lastUsedAt
            ? `Last used ${formatWhen(apiKey.lastUsedAt).toLowerCase()}`
            : 'Never used'}
        </small>
        {note && <p className="connectionNote">{note}</p>}
      </div>
      {props.canManage && (
        <div className="connectionActions">
          <Button
            variant="ghost"
            size="sm"
            className="connectionDelete"
            disabled={pending}
            onClick={() => {
              if (!confirm) {
                setConfirm(true)
                setNote('Revoke it? Anything using this key stops working.')
                return
              }
              setPending(true)
              deleteApiKey(props.organizationId, apiKey.id)
                .then(() => props.onDeleted(apiKey.id))
                .catch((cause: unknown) => {
                  setNote(problem(cause, 'Couldn’t revoke it. Try again.'))
                  setPending(false)
                })
            }}
          >
            <Trash2 /> {confirm ? 'Yes, revoke it' : 'Revoke'}
          </Button>
        </div>
      )}
    </li>
  )
}

// A new key, shown once with a copy button.
function NewKey(props: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="connectionGroup">
      <div className="secretField">
        <code>{props.value}</code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard
              .writeText(props.value)
              .then(() => setCopied(true))
              .catch(() => undefined)
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="connectionNote">Copy it now: it’s only shown once.</p>
    </div>
  )
}

// The workspace's API keys, for the WordPress plugin's site sync.
export function ApiKeys(props: { organizationId: string; canManage: boolean }) {
  const { organizationId } = props
  const [items, setItems] = useState<iApiKey[] | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState('')

  useEffect(() => {
    let active = true
    listApiKeys(organizationId)
      .then((rows) => active && setItems(rows))
      .catch(
        (cause: unknown) =>
          active && setError(problem(cause, 'Couldn’t load your keys.')),
      )
    return () => {
      active = false
    }
  }, [organizationId])

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      const { key, ...row } = await createApiKey(organizationId, name.trim())
      setItems((rows) => [row, ...(rows ?? [])])
      setName('')
      setAdding(false)
      setCreated(key ?? '')
    } catch (cause) {
      setError(problem(cause, 'Couldn’t create the key. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="connectionGroup" aria-labelledby="settings-keys">
      <div className="connectionHead">
        <KeyRound size={15} aria-hidden="true" />
        <h3 id="settings-keys">API keys</h3>
        {props.canManage && items && !adding && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
          >
            <Plus /> Create a key
          </Button>
        )}
      </div>
      <p className="connectionNote">
        The WordPress plugin uses a key to re-read your site when it changes.
      </p>
      {created && <NewKey value={created} />}
      {adding && (
        <form className="connectionForm" onSubmit={add}>
          <label className="connectionField">
            <span>What it’s for</span>
            <Input
              placeholder="WordPress"
              value={name}
              autoFocus
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="connectionFormActions">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? 'Creating…' : 'Create key'}
            </Button>
          </div>
        </form>
      )}
      {error && <p className="inlineError">{error}</p>}
      {!items ? (
        !error && <Skeleton className="h-12 rounded-xl" />
      ) : items.length > 0 ? (
        <ul className="connectionList">
          {items.map((apiKey) => (
            <ApiKeyRow
              key={apiKey.id}
              apiKey={apiKey}
              organizationId={organizationId}
              canManage={props.canManage}
              onDeleted={(id) =>
                setItems((rows) => rows?.filter((row) => row.id !== id) ?? [])
              }
            />
          ))}
        </ul>
      ) : (
        !adding && <p className="connectionEmpty">No keys yet.</p>
      )}
    </section>
  )
}

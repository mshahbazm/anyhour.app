import { AlertCircle, ArrowLeft, Loader2, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { ApiError, problem } from '../workspace/api'
import { addFact, createContact, draftContact } from './api'

interface iAddContactDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  /** Opens a contact: the new one once saved, or the one that already has the details. */
  onOpenContact: (id: string) => void
}

interface iConfirm {
  name: string
  email: string
  phone: string
  facts: string[]
  hints: Partial<Record<string, string>>
}

// Adding a contact: the owner writes who it is in their own words, checks the
// draft, then saves it with what to remember.
export function AddContactDialog(props: iAddContactDialogProps) {
  const [text, setText] = useState('')
  const [confirm, setConfirm] = useState<iConfirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [taken, setTaken] = useState<{ id: string; name: string } | null>(null)
  const { open } = props

  useEffect(() => {
    if (!open) return
    setText('')
    setConfirm(null)
    setError('')
    setTaken(null)
  }, [open])

  async function draft(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      const { draft: result, missing } = await draftContact(
        props.organizationId,
        text.trim(),
      )
      setConfirm({
        name: result.name ?? '',
        email: result.email ?? '',
        phone: result.phone ?? '',
        facts: result.facts,
        hints: Object.fromEntries(
          missing.map((item) => [item.field, item.message]),
        ),
      })
    } catch (cause) {
      setError(problem(cause, 'Couldn’t draft the contact. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!confirm || (!confirm.email.trim() && !confirm.phone.trim())) return
    setBusy(true)
    setError('')
    setTaken(null)
    let created: string | null = null
    try {
      const person = await createContact(props.organizationId, {
        name: confirm.name.trim() || null,
        email: confirm.email.trim() || null,
        phone: confirm.phone.trim() || null,
      })
      created = person.id
      for (const fact of confirm.facts)
        if (fact.trim())
          await addFact(props.organizationId, person.id, fact.trim())
      props.onOpenChange(false)
      props.onOpenContact(person.id)
    } catch (cause) {
      if (created) {
        // Saved, but a fact wasn't: open it to finish there.
        props.onOpenChange(false)
        props.onOpenContact(created)
        return
      }
      if (cause instanceof ApiError && cause.code === 'identity_taken') {
        const id = cause.detail.contactId
        const name = cause.detail.contactName
        if (typeof id === 'string')
          setTaken({
            id,
            name: typeof name === 'string' && name ? name : 'another contact',
          })
        else setError(cause.message)
      } else if (cause instanceof ApiError && cause.code === 'invalid_email')
        setError('That doesn’t look like an email address.')
      else if (cause instanceof ApiError && cause.code === 'invalid_phone')
        setError(
          'That doesn’t look like a phone number. Include the country code, like +44.',
        )
      else setError(problem(cause, 'Couldn’t save the contact. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  const field = (key: 'name' | 'email' | 'phone', value: string) =>
    confirm && setConfirm({ ...confirm, [key]: value })
  const reachable = Boolean(confirm?.email.trim() || confirm?.phone.trim())

  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        {!confirm ? (
          <form className="dialogForm" onSubmit={draft}>
            <DialogHeader>
              <DialogTitle>Add contact</DialogTitle>
              <DialogDescription>
                Write who they are in your own words. I’ll draft the contact for
                you to check before anything is saved.
              </DialogDescription>
            </DialogHeader>
            <label className="formField">
              <span>Who is it?</span>
              <textarea
                className="textField"
                rows={4}
                value={text}
                maxLength={4000}
                autoFocus
                placeholder="Ali, ali@pizzahub.com, +44 7700 900123, wants a new website"
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
                    void draft(event)
                }}
              />
            </label>
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
              <Button type="submit" disabled={busy || !text.trim()}>
                {busy ? <Loader2 className="spin" /> : <Sparkles />}
                {busy ? 'Drafting…' : 'Draft contact'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form className="dialogForm" onSubmit={save}>
            <DialogHeader>
              <DialogTitle>Check the contact</DialogTitle>
              <DialogDescription>
                Fix anything I got wrong, then save.
              </DialogDescription>
            </DialogHeader>
            <label className="formField">
              <span>Name</span>
              <input
                className="textField"
                value={confirm.name}
                maxLength={200}
                onChange={(event) => field('name', event.target.value)}
              />
              <Hint text={!confirm.name.trim() ? confirm.hints.name : ''} />
            </label>
            <div className="formRow">
              <label className="formField">
                <span>Email</span>
                <input
                  className="textField"
                  type="email"
                  value={confirm.email}
                  maxLength={320}
                  onChange={(event) => field('email', event.target.value)}
                />
                <Hint
                  text={
                    !reachable
                      ? (confirm.hints.email ??
                        'Add an email or phone so you can reach them.')
                      : confirm.email.trim()
                        ? confirm.hints.email
                        : ''
                  }
                />
              </label>
              <label className="formField">
                <span>Phone</span>
                <input
                  className="textField"
                  type="tel"
                  value={confirm.phone}
                  maxLength={40}
                  placeholder="+44 7700 900123"
                  onChange={(event) => field('phone', event.target.value)}
                />
                <Hint text={confirm.phone.trim() ? confirm.hints.phone : ''} />
              </label>
            </div>
            {confirm.facts.length > 0 && (
              <div className="formField">
                <span>I’ll remember</span>
                <ul className="draftFacts">
                  {confirm.facts.map((fact, index) => (
                    <li key={`${index}-${fact}`}>
                      <p>{fact}</p>
                      <button
                        type="button"
                        className="iconButton"
                        aria-label={`Don’t remember “${fact}”`}
                        onClick={() =>
                          setConfirm({
                            ...confirm,
                            facts: confirm.facts.filter(
                              (_, at) => at !== index,
                            ),
                          })
                        }
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {taken && (
              <div className="inlineNotice takenNotice" role="alert">
                <span>{taken.name} already has this email or phone.</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    props.onOpenChange(false)
                    props.onOpenContact(taken.id)
                  }}
                >
                  Open {taken.name}
                </Button>
              </div>
            )}
            {error && (
              <p className="inlineError" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                className="mr-auto"
                disabled={busy}
                onClick={() => {
                  setConfirm(null)
                  setTaken(null)
                  setError('')
                }}
              >
                <ArrowLeft /> Back
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => props.onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !reachable}>
                {busy ? 'Saving…' : 'Save contact'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Hint({ text }: { text?: string }) {
  if (!text) return null
  return (
    <small className="draftHint">
      <AlertCircle size={12} /> {text}
    </small>
  )
}

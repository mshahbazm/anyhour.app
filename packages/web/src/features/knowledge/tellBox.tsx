import { Link } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { noteConflicts } from '../conversations/api'
import type { iNoteConflicts } from '../conversations/api'
import { api, ApiError, problem } from '../workspace/api'
import type { iKnowledgeNote } from './useKnowledgeNotes'

// Mirrors tNoteDraft in packages/api/src/types/draft.types.ts.
type tNoteDraft =
  | { kind: 'note'; title: string; text: string; noteId: string | null }
  | { kind: 'rule' }
  | { kind: 'nothing' }

type tOverrides = Array<{ sourceId: string; excerpt: string }>

interface iDraftedNote {
  title: string
  text: string
  noteId: string | null
}

const sameTitle = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

// "Tell (name) something about your business": the owner's words become a
// note in one step. The note is drafted, checked against the website like
// any note, and saved; only a disagreement with the website shows the
// draft to edit and choose. A note with the same title is updated.
export function TellBox(props: {
  /** .../business */
  base: string
  organizationId: string
  assistantId: string
  botName: string
  disabled: boolean
  /** Text to start from, e.g. "We're open "; a new key focuses the box. */
  prefill: { text: string; key: number } | null
  onSaved: () => void
}) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<'rule' | 'saved' | null>(null)
  const [savedTitle, setSavedTitle] = useState('')
  const [conflict, setConflict] = useState<{
    note: iDraftedNote
    found: iNoteConflicts
  } | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const { prefill } = props

  useEffect(() => {
    if (!prefill) return
    setText(prefill.text)
    setNotice(null)
    setError('')
    const input = field.current
    if (!input) return
    input.scrollIntoView({ block: 'center', behavior: 'smooth' })
    input.focus()
    input.setSelectionRange(prefill.text.length, prefill.text.length)
  }, [prefill])

  async function save(note: iDraftedNote, overrides?: tOverrides) {
    const body = { title: note.title, text: note.text, overrides }
    const update = (id: string) =>
      api(`${props.base}/notes/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
    if (note.noteId) await update(note.noteId)
    else
      try {
        await api(`${props.base}/notes`, {
          method: 'POST',
          body: JSON.stringify(body),
        })
      } catch (cause) {
        // Saved meanwhile under the same title: update that note instead.
        const existing =
          cause instanceof ApiError && cause.code === 'note_exists'
            ? (await api<iKnowledgeNote[]>(`${props.base}/notes`)).find(
                (item) => sameTitle(item.title, note.title),
              )
            : undefined
        if (!existing) throw cause
        await update(existing.id)
      }
    setText('')
    setConflict(null)
    setSavedTitle(note.title)
    setNotice('saved')
    props.onSaved()
  }

  async function run(work: () => Promise<void>) {
    setPending(true)
    setError('')
    try {
      await work()
    } catch (cause) {
      setError(problem(cause, 'Couldn’t save this. Try again.'))
    } finally {
      setPending(false)
    }
  }

  const submit = () =>
    run(async () => {
      const words = text.trim()
      if (!words) return
      setNotice(null)
      const draft = await api<tNoteDraft>(`${props.base}/notes/drafts`, {
        method: 'POST',
        body: JSON.stringify({ text: words }),
      })
      if (draft.kind === 'rule') {
        setNotice('rule')
        return
      }
      if (draft.kind === 'nothing') {
        setError('I couldn’t find a fact in that. Try saying it another way.')
        return
      }
      const note = {
        title: draft.title,
        text: draft.text,
        noteId: draft.noteId,
      }
      const found = await noteConflicts(
        props.organizationId,
        props.assistantId,
        { title: note.title, text: note.text },
        note.noteId,
      )
      if (found.conflicts.length) {
        setConflict({ note, found })
        return
      }
      await save(note)
    })

  if (conflict) {
    const { note, found } = conflict
    const ready = note.title.trim() && note.text.trim()
    const edit = (change: Partial<iDraftedNote>) =>
      setConflict({ found, note: { ...note, ...change } })
    return (
      <section className="tellBox" aria-label={`Tell ${props.botName}`}>
        <strong className="tellBoxTitle">
          {found.conflicts.length === 1
            ? `Your ${found.conflicts[0].page} page says something different`
            : 'Your website says something different'}
        </strong>
        <dl className="tellBoxPages">
          {found.conflicts.map((item) => (
            <div key={item.page}>
              <dt>{item.page} page says</dt>
              <dd>{item.pageSays}</dd>
            </div>
          ))}
        </dl>
        <input
          className="textField"
          aria-label="Topic"
          maxLength={120}
          value={note.title}
          disabled={pending}
          onChange={(event) => edit({ title: event.target.value })}
        />
        <Textarea
          aria-label={`What ${props.botName} will say`}
          rows={2}
          maxLength={2000}
          value={note.text}
          disabled={pending}
          onChange={(event) => edit({ text: event.target.value })}
        />
        {error && <p className="inlineError">{error}</p>}
        <div className="tellBoxActions">
          <Button
            size="sm"
            disabled={pending || !ready}
            onClick={() =>
              void run(() =>
                save(
                  {
                    ...note,
                    title: note.title.trim(),
                    text: note.text.trim(),
                  },
                  found.conflicts.flatMap((item) =>
                    item.sourceIds.map((sourceId) => ({
                      sourceId,
                      excerpt: item.pageSays,
                    })),
                  ),
                ),
              )
            }
          >
            {pending && <Loader2 className="spin" />}
            Use my answer
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setConflict(null)}
          >
            Keep the website’s answer
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="tellBox" aria-label={`Tell ${props.botName}`}>
      <Textarea
        ref={field}
        rows={2}
        maxLength={4000}
        value={text}
        disabled={props.disabled || pending}
        placeholder={`Tell ${props.botName} something about your business, e.g. “We’re open 9 to 5, Monday to Friday” or “Delivery is free over £50”`}
        aria-label={`Tell ${props.botName} something about your business`}
        onChange={(event) => {
          setText(event.target.value)
          if (notice === 'saved') setNotice(null)
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      {error && <p className="inlineError">{error}</p>}
      <div className="tellBoxActions">
        {notice === 'rule' ? (
          <p className="tellBoxNotice">
            That sounds like how {props.botName} should talk, so it’s a rule.{' '}
            <Link to="/rules">Add it in Rules</Link>
          </p>
        ) : notice === 'saved' ? (
          <p className="tellBoxNotice" role="status">
            Saved to your business: {savedTitle}
          </p>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          disabled={props.disabled || pending || !text.trim()}
          onClick={() => void submit()}
        >
          {pending && <Loader2 className="spin" />}
          Save
        </Button>
      </div>
    </section>
  )
}

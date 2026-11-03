import { BookmarkPlus, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { problem } from '../workspace/api'
import { dismissNoteOffer, noteConflicts, saveLearnedNote } from './api'
import type { iNoteConflicts } from './api'
import type { iNoteOffer } from './types'

// Under a reply that answered a conversation needing you: your AI offers
// to remember the answer as a note in Your business. Save checks the website
// first, like any note; when a page disagrees you choose whose answer wins.
export function NoteOfferCard(props: {
  organizationId: string
  assistantId: string
  conversationId: string
  messageId: string
  offer: iNoteOffer
  /** The offer was answered (saved or not now), so it can go. */
  onDone: () => void
}) {
  const [title, setTitle] = useState(props.offer.title)
  const [text, setText] = useState(props.offer.text)
  const [conflicts, setConflicts] = useState<iNoteConflicts | null>(null)
  const [pending, setPending] = useState<'save' | 'dismiss' | null>(null)
  const [error, setError] = useState('')
  const note = { title: title.trim(), text: text.trim() }

  async function run(kind: 'save' | 'dismiss', work: () => Promise<void>) {
    setPending(kind)
    setError('')
    try {
      await work()
    } catch (cause) {
      setError(
        problem(
          cause,
          kind === 'save'
            ? 'Couldn’t save this. Try again.'
            : 'Couldn’t dismiss this. Try again.',
        ),
      )
    } finally {
      setPending(null)
    }
  }

  const save = (overrides?: Array<{ sourceId: string; excerpt: string }>) =>
    run('save', async () => {
      await saveLearnedNote(props.organizationId, {
        ...note,
        fromMessageId: props.messageId,
        overrides,
      })
      props.onDone()
    })

  const check = () =>
    run('save', async () => {
      const found = await noteConflicts(
        props.organizationId,
        props.assistantId,
        note,
      )
      if (found.conflicts.length) {
        setConflicts(found)
        return
      }
      await saveLearnedNote(props.organizationId, {
        ...note,
        fromMessageId: props.messageId,
      })
      props.onDone()
    })

  const dismiss = () =>
    run('dismiss', async () => {
      await dismissNoteOffer(
        props.organizationId,
        props.conversationId,
        props.messageId,
      )
      props.onDone()
    })

  if (conflicts) {
    const one = conflicts.conflicts.length === 1
    return (
      <div className="noteOfferCard" role="group" aria-label="Save this answer">
        <strong>
          {one
            ? `Your ${conflicts.conflicts[0].page} page says something different`
            : 'Your website says something different'}
        </strong>
        <dl>
          {conflicts.conflicts.map((item) => (
            <div key={item.page}>
              <dt>{item.page} page says</dt>
              <dd>{item.pageSays}</dd>
            </div>
          ))}
          <div>
            <dt>I’ll say</dt>
            <dd>{conflicts.youWillSay ?? note.text}</dd>
          </div>
        </dl>
        {error && <p className="inlineError">{error}</p>}
        <div className="inboxActions">
          <Button
            size="sm"
            disabled={pending !== null}
            onClick={() =>
              void save(
                conflicts.conflicts.flatMap((item) =>
                  item.sourceIds.map((sourceId) => ({
                    sourceId,
                    excerpt: item.pageSays,
                  })),
                ),
              )
            }
          >
            {pending === 'save' && <Loader2 className="spin" />}
            Use my new answer
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void dismiss()}
          >
            Keep the website’s answer
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="noteOfferCard" role="group" aria-label="Save this answer">
      <strong>
        <BookmarkPlus size={14} aria-hidden="true" />
        Save this so I can answer it next time?
      </strong>
      <input
        className="textField"
        aria-label="Topic"
        maxLength={120}
        value={title}
        disabled={pending !== null}
        onChange={(event) => setTitle(event.target.value)}
      />
      <textarea
        className="textField"
        aria-label="What I’ll remember"
        rows={2}
        maxLength={2000}
        value={text}
        disabled={pending !== null}
        onChange={(event) => setText(event.target.value)}
      />
      {error && <p className="inlineError">{error}</p>}
      <div className="inboxActions">
        <Button
          size="sm"
          disabled={!note.title || !note.text || pending !== null}
          onClick={() => void check()}
        >
          {pending === 'save' && <Loader2 className="spin" />}
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending !== null}
          onClick={() => void dismiss()}
        >
          Not now
        </Button>
      </div>
    </div>
  )
}

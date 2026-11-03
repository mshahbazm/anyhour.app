import { ChevronRight, MessageSquareQuote, Plus } from 'lucide-react'
import { formatWhen } from '../workspace/formatWhen'
import type { iKnowledgeNote } from './useKnowledgeNotes'

// Facts the owner told in chat, kept apart from the website.
export function NotesSection(props: {
  title: string
  notes: iKnowledgeNote[]
  /** One line for an empty list. */
  empty: string
  canEdit: boolean
  disabled: boolean
  onOpen: (id: string) => void
  /** Starts a chat to tell a new fact. */
  onAdd?: () => void
  addLabel?: string
}) {
  return (
    <section className="understandingBlock" aria-labelledby="notes">
      <div className="understandingBlockHead">
        <h2 id="notes" className="understandingHeading">
          {props.title}
          {props.notes.length > 0 && (
            <span className="countPill">{props.notes.length}</span>
          )}
        </h2>
        {props.canEdit && props.onAdd && (
          <button
            type="button"
            className="miniAction"
            disabled={props.disabled}
            onClick={props.onAdd}
          >
            <Plus size={13} /> {props.addLabel ?? 'Add a fact'}
          </button>
        )}
      </div>
      {props.notes.length ? (
        <ul className="noteList">
          {props.notes.map((note) => (
            <li key={note.id}>
              <button type="button" onClick={() => props.onOpen(note.id)}>
                <span className="itemIcon is-owner" aria-hidden="true">
                  <MessageSquareQuote size={15} />
                </span>
                <span className="itemText">
                  <strong>{note.title}</strong>
                  <small>{note.text}</small>
                </span>
                {note.overrides.length > 0 && (
                  <span
                    className="noteDiffers"
                    title={`Differs from: ${note.overrides.map((item) => item.page).join(', ')}`}
                  >
                    Differs from website
                  </span>
                )}
                <span className="noteWhen">{formatWhen(note.updatedAt)}</span>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="understandingHint">{props.empty}</p>
      )}
    </section>
  )
}

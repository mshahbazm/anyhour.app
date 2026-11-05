import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { api, problem } from '../workspace/api'
import type {
  iAssistant,
  iWhatsappQuestion,
  tWhatsappApproach,
} from '../workspace/types'

export const whatsappQuestionLength = 80
const defaultQuestion = 'Chat with us on WhatsApp'

const approaches: Array<{ id: tWhatsappApproach; label: string }> = [
  { id: 'straightAway', label: 'Share it straight away' },
  { id: 'quickQuestion', label: 'Ask their name and what they need first' },
  { id: 'qualifyFirst', label: 'Qualify them first' },
]

type tNumberSource = 'channel' | 'knowledge' | null

/** Mirrors GET …/whatsapp-question/number. */
interface iNumberLookup {
  number: string | null
  source: tNumberSource
}

const sourceHints: Record<'channel' | 'knowledge', string> = {
  channel: 'From your WhatsApp channel',
  knowledge: 'Found on your website',
}

/** What the panel starts from: the saved question, or a found number. */
export interface iWhatsappDraft {
  saved: iWhatsappQuestion | null
  found: iNumberLookup
}

function whatsappPath(organizationId: string, botId: string) {
  return `/api/organizations/${organizationId}/assistants/${botId}/whatsapp-question`
}

/** Looks for a WhatsApp number to start from; none when it can't. */
export async function findWhatsappNumber(
  organizationId: string,
  botId: string,
): Promise<iNumberLookup> {
  try {
    return await api<iNumberLookup>(
      `${whatsappPath(organizationId, botId)}/number`,
    )
  } catch {
    return { number: null, source: null }
  }
}

/** Removes the WhatsApp question and its rule; returns the refreshed AI. */
export async function removeWhatsappQuestion(
  organizationId: string,
  botId: string,
) {
  await api<void>(whatsappPath(organizationId, botId), { method: 'DELETE' })
  return api<iAssistant>(
    `/api/organizations/${organizationId}/assistants/${botId}`,
  )
}

// Edits the WhatsApp question inline, in the same chat-preview look.
export function WhatsappPanel(props: {
  organizationId: string
  botId: string
  draft: iWhatsappDraft
  onSaved: (bot: iAssistant) => void
  onCancel: () => void
}) {
  const { saved, found } = props.draft
  const [question, setQuestion] = useState(saved?.question ?? defaultQuestion)
  const [number, setNumber] = useState(
    saved
      ? `+${saved.number}`
      : found.number
        ? `+${found.number.replace(/^\+/, '')}`
        : '',
  )
  const [approach, setApproach] = useState<iWhatsappQuestion['approach']>(
    saved?.approach ?? 'quickQuestion',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const hint =
    !saved && found.number && found.source ? sourceHints[found.source] : null
  const options =
    saved?.approach === 'custom'
      ? [...approaches, { id: 'custom' as const, label: 'Your own rule' }]
      : approaches

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!question.trim()) return setError('Add the question visitors tap.')
    if (!number.trim()) return setError('Add your WhatsApp number or link.')
    setSaving(true)
    setError('')
    try {
      const path = whatsappPath(props.organizationId, props.botId)
      await api(path, {
        method: 'PUT',
        body: JSON.stringify({
          question: question.trim(),
          number: number.trim(),
          approach,
        }),
      })
      props.onSaved(
        await api<iAssistant>(
          `/api/organizations/${props.organizationId}/assistants/${props.botId}`,
        ),
      )
    } catch (cause) {
      setError(problem(cause, 'Could not save the WhatsApp question.'))
      setSaving(false)
    }
  }

  return (
    <form className="whatsappPanel" onSubmit={(event) => void submit(event)}>
      <label className="whatsappField">
        <span>Question</span>
        <Input
          value={question}
          maxLength={whatsappQuestionLength}
          autoFocus
          onChange={(event) => setQuestion(event.target.value)}
        />
      </label>
      <label className="whatsappField">
        <span>
          {hint || saved
            ? 'WhatsApp number'
            : 'What’s your WhatsApp number or link?'}
        </span>
        <Input
          value={number}
          placeholder="+44 7700 900123 or wa.me/447700900123"
          maxLength={200}
          inputMode="tel"
          onChange={(event) => setNumber(event.target.value)}
        />
        {hint && <small>{hint}</small>}
      </label>
      <fieldset className="whatsappField">
        <legend>When someone taps it</legend>
        {options.map((option) => (
          <label key={option.id} className="whatsappChoice">
            <input
              type="radio"
              name="whatsappApproach"
              checked={approach === option.id}
              onChange={() => setApproach(option.id)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      {error && (
        <p className="whatsappError" role="alert">
          {error}
        </p>
      )}
      <div className="whatsappActions">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}

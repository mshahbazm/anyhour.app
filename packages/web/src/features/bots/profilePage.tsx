import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { problem } from '../workspace/api'
import type { iAssistant } from '../workspace/types'
import { updateAssistant } from './api'
import { BotPictureCreator } from './botPictureCreator'
import './bots.css'

interface iProfilePageProps {
  organizationId: string
  bot: iAssistant
  canEdit: boolean
  onChanged: (bot: iAssistant) => void
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="profileSection">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  )
}

// The AI's Profile: its name, what it does in one sentence, and its picture.
export function ProfilePage(props: iProfilePageProps) {
  const { bot } = props
  return (
    <div className="page aiProfile">
      <Section title="Name">
        <ProfileField
          key={bot.name}
          {...props}
          label="Name"
          value={bot.name}
          maxLength={120}
          required
          save={(name) => ({ name })}
        />
      </Section>
      <Section title="What I do">
        <ProfileField
          key={bot.job ?? ''}
          {...props}
          label={`What ${bot.name} does`}
          value={bot.job ?? ''}
          placeholder="Answers your customers on WhatsApp and books them in"
          maxLength={300}
          multiline
          save={(job) => ({ job: job || null })}
        />
      </Section>
      <Section title="Picture">
        <BotPictureCreator
          organizationId={props.organizationId}
          bot={bot}
          disabled={!props.canEdit}
          onCreated={props.onChanged}
        />
      </Section>
    </div>
  )
}

// One field saved on its own. Members read it only.
function ProfileField(
  props: iProfilePageProps & {
    label: string
    value: string
    placeholder?: string
    maxLength: number
    required?: boolean
    multiline?: boolean
    save: (value: string) => Partial<iAssistant>
  },
) {
  const [value, setValue] = useState(props.value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const next = value.trim()
  const changed = next !== props.value.trim()

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!changed || saving || (props.required && !next)) return
    setSaving(true)
    setError('')
    try {
      props.onChanged(
        await updateAssistant(
          props.organizationId,
          props.bot.id,
          props.save(next),
        ),
      )
    } catch (cause) {
      setError(problem(cause, 'Couldn’t save. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  const field = {
    'aria-label': props.label,
    value,
    placeholder: props.placeholder,
    maxLength: props.maxLength,
    disabled: !props.canEdit || saving,
  }
  return (
    <form className="profileForm" onSubmit={(event) => void save(event)}>
      {props.multiline ? (
        <Textarea
          {...field}
          rows={2}
          onChange={(event) => setValue(event.target.value)}
        />
      ) : (
        <input
          {...field}
          className="textField"
          onChange={(event) => setValue(event.target.value)}
        />
      )}
      {props.canEdit && changed && (
        <div className="profileFormActions">
          <Button
            type="submit"
            size="sm"
            disabled={saving || (props.required && !next)}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => setValue(props.value)}
          >
            Cancel
          </Button>
        </div>
      )}
      {error && <p className="inlineError">{error}</p>}
    </form>
  )
}

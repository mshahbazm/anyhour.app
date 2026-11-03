import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { createBotPicture } from './api'
import { BotAvatar } from './botAvatar'
import { pictureStyles } from './pictureStyles'
import type { tPictureStyle } from './pictureStyles'
import type { iAssistant } from '../workspace/types'

interface iBotPictureCreatorProps {
  organizationId: string
  bot: iAssistant
  disabled?: boolean
  onCreated: (bot: iAssistant) => void
}

// Generates a photorealistic profile picture from a saved style and optional description.
export function BotPictureCreator(props: iBotPictureCreatorProps) {
  const [style, setStyle] = useState<tPictureStyle>('industry')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function create() {
    setCreating(true)
    setError('')
    try {
      props.onCreated(
        await createBotPicture(props.organizationId, props.bot.id, {
          style,
          description: description.trim() || null,
        }),
      )
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not create the picture',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="pictureCreator">
      <div className={`picturePreview ${creating ? 'is-creating' : ''}`}>
        <BotAvatar
          bot={props.bot}
          organizationId={props.organizationId}
          size={88}
        />
        {creating && <span className="pictureShimmer" aria-hidden="true" />}
      </div>
      <div className="pictureControls">
        <div
          className="styleChips"
          role="radiogroup"
          aria-label="Picture style"
        >
          {pictureStyles.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={style === item.id}
              disabled={creating || props.disabled}
              onClick={() => setStyle(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor={`picture-${props.bot.id}`}>
          Describe the person (optional)
        </label>
        <input
          id={`picture-${props.bot.id}`}
          className="textField"
          placeholder="Optional: e.g. woman in her 30s, curly hair, warm smile"
          maxLength={400}
          value={description}
          disabled={creating || props.disabled}
          onChange={(event) => setDescription(event.target.value)}
        />
        <div className="pictureActions">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={creating || props.disabled}
            onClick={() => void create()}
          >
            <Sparkles />
            {creating
              ? 'Creating… about 20 seconds'
              : props.bot.pictureKey
                ? 'Create another'
                : 'Create picture'}
          </Button>
          {error && (
            <span className="inlineError" role="alert">
              {error}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

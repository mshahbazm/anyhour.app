import {
  brandStyle,
  defaultAppearance,
  LauncherIcon,
  launcherIconIds,
  launcherIcons,
  launcherLabel,
  launcherLabelLength,
  LauncherButton,
} from '@anyhour/widget'
import type { tLauncherIcon, tLauncherStyle } from '@anyhour/widget'
import { useRef, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import { BotAvatar, botPictureUrl } from '../bots/botAvatar'
import { api } from '../workspace/api'
import type { iAssistant, tOwnerAppearance } from '../workspace/types'
import { FirstImpression } from './firstImpression'
import '@anyhour/widget/styles.css'
import './tryBot.css'

const swatches = [
  '#171717',
  '#2563eb',
  '#0f766e',
  '#16a34a',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#7c3aed',
]
const launchers: Array<{ id: tLauncherStyle; label: string }> = [
  { id: 'avatar', label: 'Photo' },
  { id: 'icon', label: 'Icon' },
  { id: 'label', label: 'Button' },
]

interface iLookProps {
  organizationId: string | null
  bot: iAssistant | undefined
  canEdit: boolean
  onChanged: (bot: iAssistant) => void
}

// How the chat looks on the owner's website, in a sheet beside the preview.
export function LookSheet(
  props: iLookProps & { open: boolean; onOpenChange: (open: boolean) => void },
) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="lookSheet">
        {/* Keyed by member, so switching starts from its own settings. */}
        <LookSettings key={props.bot?.id} {...props} />
      </SheetContent>
    </Sheet>
  )
}

function LookSettings(props: iLookProps) {
  const bot = props.bot
  const saved: tOwnerAppearance = {
    ...defaultAppearance,
    whatsapp: null,
    ...bot?.appearance,
  }
  const [appearance, setAppearance] = useState<tOwnerAppearance>(saved)
  const [welcome, setWelcome] = useState(bot?.welcomeMessage ?? '')
  const [hex, setHex] = useState(saved.brandColor ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const disabled = !props.canEdit || !bot
  const name = bot?.name ?? 'us'

  // Changes save on their own, a moment after the owner stops editing.
  function save(next: {
    appearance?: Omit<tOwnerAppearance, 'whatsapp'>
    welcomeMessage?: string
  }) {
    if (!props.organizationId || !bot) return
    window.clearTimeout(timer.current)
    setStatus('saving')
    timer.current = window.setTimeout(() => {
      api<iAssistant>(
        `/api/organizations/${props.organizationId}/assistants/${bot.id}`,
        { method: 'PATCH', body: JSON.stringify(next) },
      )
        .then((updated) => {
          props.onChanged(updated)
          setStatus('saved')
          setError('')
        })
        .catch((cause: unknown) => {
          setStatus('idle')
          setError(cause instanceof Error ? cause.message : 'Could not save')
        })
    }, 500)
  }
  function update(change: Partial<Omit<tOwnerAppearance, 'whatsapp'>>) {
    const next = { ...appearance, ...change }
    setAppearance(next)
    // The WhatsApp question saves through its own endpoint, never here.
    const { whatsapp: _whatsapp, ...rest } = next
    save({ appearance: rest })
  }

  return (
    <div className="lookView">
      <SheetHeader className="lookHead">
        <SheetTitle>Customize look</SheetTitle>
        <SheetDescription className={error ? 'is-error' : ''} role="status">
          {error ||
            (status === 'saving'
              ? 'Saving…'
              : status === 'saved'
                ? 'Saved'
                : 'Changes save as you go.')}
        </SheetDescription>
      </SheetHeader>
      {/* The closed chat as it sits on a page, updating as the owner edits. */}
      <div className="lookPreview" style={brandStyle(appearance)}>
        <LauncherButton
          appearance={appearance}
          name={bot?.name ?? 'your AI'}
          pictureUrl={botPictureUrl(props.organizationId, bot)}
          open={false}
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>
      <div className="lookBody">
        <section className="lookField">
          <h3>Brand colour</h3>
          <div className="swatches">
            {swatches.map((color) => (
              <button
                key={color}
                type="button"
                className="swatch"
                style={{ background: color }}
                aria-label={`Use ${color}`}
                aria-pressed={(appearance.brandColor ?? '#171717') === color}
                disabled={disabled}
                onClick={() => {
                  setHex(color)
                  update({ brandColor: color })
                }}
              />
            ))}
            <input
              className="textField hexField"
              aria-label="Custom colour"
              placeholder="#2563eb"
              value={hex}
              maxLength={7}
              disabled={disabled}
              onChange={(event) => {
                const value = event.target.value.trim()
                setHex(value)
                if (/^#[0-9a-f]{6}$/i.test(value)) update({ brandColor: value })
              }}
            />
          </div>
        </section>

        <section className="lookField">
          <h3>Chat button</h3>
          <div className="launcherChoices" role="radiogroup">
            {launchers.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={appearance.launcher === option.id}
                disabled={disabled}
                onClick={() => update({ launcher: option.id })}
              >
                <span className="launcherSample" style={brandStyle(appearance)}>
                  <LauncherFace
                    style={option.id}
                    icon={appearance.launcherIcon}
                    label={appearance.launcherLabel}
                    bot={bot}
                    organizationId={props.organizationId}
                    compact
                  />
                </span>
                {option.label}
              </button>
            ))}
          </div>
          {appearance.launcher !== 'avatar' && (
            <div className="iconChoices" role="radiogroup" aria-label="Icon">
              {launcherIconIds.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  role="radio"
                  aria-checked={(appearance.launcherIcon ?? 'chat') === icon}
                  aria-label={launcherIcons[icon].label}
                  title={launcherIcons[icon].label}
                  disabled={disabled}
                  onClick={() => update({ launcherIcon: icon })}
                >
                  <LauncherIcon icon={icon} size={18} />
                </button>
              ))}
            </div>
          )}
          {appearance.launcher === 'label' && (
            <input
              className="textField labelField"
              aria-label="Button text"
              placeholder={launcherLabel(
                { ...appearance, launcherLabel: '' },
                name,
              )}
              value={appearance.launcherLabel ?? ''}
              maxLength={launcherLabelLength}
              disabled={disabled}
              onChange={(event) =>
                update({ launcherLabel: event.target.value })
              }
            />
          )}
        </section>

        <FirstImpression
          bot={bot}
          organizationId={props.organizationId}
          appearance={appearance}
          welcome={welcome}
          disabled={disabled}
          onWelcome={(text) => {
            setWelcome(text)
            save({ welcomeMessage: text.trim() || 'How can I help?' })
          }}
          onQuestions={(starterPrompts) => update({ starterPrompts })}
          onWhatsapp={(updated) => {
            setAppearance((current) => ({
              ...current,
              whatsapp: updated.appearance?.whatsapp ?? null,
            }))
            props.onChanged(updated)
          }}
        />
      </div>
    </div>
  )
}

function LauncherFace(props: {
  style: tLauncherStyle
  icon?: tLauncherIcon
  label?: string
  bot: iAssistant | undefined
  organizationId: string | null
  compact?: boolean
}) {
  if (props.style === 'avatar')
    return (
      <BotAvatar
        bot={props.bot}
        organizationId={props.organizationId}
        size={props.compact ? 30 : 46}
      />
    )
  return (
    <>
      <LauncherIcon icon={props.icon} size={props.compact ? 15 : 20} />
      {props.style === 'label' && (
        <span>
          {props.label?.trim() ||
            (props.compact ? 'Chat' : `Chat with ${props.bot?.name ?? 'us'}`)}
        </span>
      )}
    </>
  )
}

import {
  brandStyle,
  defaultAppearance,
  LauncherButton,
  Teaser,
} from '@anyhour/widget'
import { Paintbrush } from 'lucide-react'
import { useEffect, useState } from 'react'
import { botPictureUrl } from '../bots/botAvatar'
import type { iAssistant } from '../workspace/types'
import { TestChat } from './testChat'
import '@anyhour/widget/launcher.css'
import './tryBot.css'

// The bot as it sits on a website: closed first, with its greeting and
// starter questions, then opened at its real size. The chat stays mounted
// while closed, so reopening keeps the conversation.
export function TryStage(props: {
  organizationId: string | null
  bot: iAssistant | undefined
  ready: boolean
  onSource: (id: string) => void
  /** Opens the look settings; shown on the stage when given. */
  onCustomize?: () => void
  /** Questions on the closed chat; the saved starter questions by default. */
  prompts?: string[]
  /** A question asked from outside the stage, sent when it changes. */
  prompt?: { text: string; id: number } | null
}) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState<{ text: string; id: number } | null>(
    null,
  )
  const name = props.bot?.name ?? 'your AI'
  const appearance = { ...defaultAppearance, ...props.bot?.appearance }
  const outside = props.prompt
  useEffect(() => {
    if (!outside) return
    setPrompt(outside)
    setOpen(true)
  }, [outside])
  return (
    <div className="tryStage" style={brandStyle(appearance)}>
      <div className="tryStageBar">
        <p className="tryStageLabel">
          <span className="stageDot" aria-hidden="true" />
          Test chat · no real leads
        </p>
        {props.onCustomize && (
          <button
            type="button"
            className="stageCustomize"
            onClick={props.onCustomize}
          >
            <Paintbrush size={14} /> Customize look
          </button>
        )}
      </div>
      <div className={`stageSite ${open ? 'is-open' : ''}`}>
        <div className="stageWindow" hidden={!open}>
          <TestChat
            organizationId={props.organizationId}
            assistant={props.bot}
            ready={props.ready}
            onSource={props.onSource}
            prompt={prompt}
            onClose={() => setOpen(false)}
          />
        </div>
        {!open && (
          <div className="stageClosed">
            {/* A note on the page, not part of the widget, pointing at it. */}
            <div className="stageNote" aria-hidden="true">
              <p>
                <strong>Try it like a visitor</strong>
                Tap the bubble or a question
              </p>
              <svg className="stageArrow" viewBox="0 0 40 28">
                <path d="M3 6 C 14 2, 28 6, 33 20" />
                <path d="M27 17 L 33 21 L 37 14" />
              </svg>
            </div>
            <Teaser
              name={name}
              welcomeMessage={props.bot?.welcomeMessage}
              prompts={
                appearance.starterPrompts.length
                  ? appearance.starterPrompts
                  : (props.prompts ?? [])
              }
              onOpen={() => setOpen(true)}
              onPrompt={(text) => {
                setPrompt({ text, id: Date.now() })
                setOpen(true)
              }}
            />
          </div>
        )}
        <LauncherButton
          appearance={appearance}
          name={name}
          pictureUrl={botPictureUrl(props.organizationId, props.bot)}
          open={open}
          className="stageLauncher"
          onClick={() => setOpen(!open)}
        />
      </div>
    </div>
  )
}

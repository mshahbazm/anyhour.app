import { Check } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { api, problem } from '../workspace/api'
import type { iChatBlock, iRuleDraftPayload } from '../workspace/types'
import { RuleLine, StepsCard } from './ruleViews'
import './memberRules.css'

export interface iRuleDraftHandlers {
  /** Owners and admins save; everyone else sees the card read-only. */
  canEdit: boolean
  onAct: (block: iChatBlock, action: 'save' | 'dismiss') => Promise<void>
  /** Opens the AI's Rules. */
  onOpen: () => void
}

/** Saves or dismisses the rules on a chat card; returns the card as saved. */
export function actOnRuleDraft(
  chatId: string,
  blockId: string,
  action: 'save' | 'dismiss',
) {
  return api<iChatBlock>(
    `/api/workspace-agent/chats/${encodeURIComponent(chatId)}/blocks/${encodeURIComponent(blockId)}/rule-draft`,
    { method: 'POST', body: JSON.stringify({ action }) },
  )
}

// Rules drafted in the chat, shown the way they'll read, with Save.
export function RuleDraftCard(
  props: iRuleDraftHandlers & {
    block: iChatBlock
    payload: iRuleDraftPayload
    disabled: boolean
  },
) {
  const [pending, setPending] = useState<'save' | 'dismiss' | null>(null)
  const [error, setError] = useState('')
  const { payload } = props

  async function act(action: 'save' | 'dismiss') {
    setPending(action)
    setError('')
    try {
      await props.onAct(props.block, action)
    } catch (cause) {
      setError(problem(cause, 'Couldn’t do that. Try again.'))
    } finally {
      setPending(null)
    }
  }

  return (
    <section
      className={`chatCard ruleDraftCard is-${payload.status}`}
      aria-label="Rules to save"
    >
      <div className="ruleDraftCardList">
        {payload.rules.map((rule, index) =>
          rule.kind === 'steps' ? (
            <StepsCard key={index} rule={rule} />
          ) : (
            <div key={index} className="ruleDraftCardLine">
              <RuleLine rule={rule} />
            </div>
          ),
        )}
      </div>
      {payload.status === 'saved' ? (
        <div className="ruleDraftCardFooter">
          <span className="ruleDraftCardDone">
            <Check size={14} /> Saved
          </span>
          <Button size="sm" variant="ghost" onClick={props.onOpen}>
            See all rules
          </Button>
        </div>
      ) : payload.status === 'dismissed' ? (
        <div className="ruleDraftCardFooter">
          <span className="ruleDraftCardDone">Not saved</span>
        </div>
      ) : (
        props.canEdit && (
          <div className="ruleDraftCardFooter">
            <Button
              size="sm"
              disabled={props.disabled || pending !== null}
              onClick={() => void act('save')}
            >
              {pending === 'save' ? 'Saving…' : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={props.disabled || pending !== null}
              onClick={() => void act('dismiss')}
            >
              Not now
            </Button>
          </div>
        )
      )}
      {error && (
        <p className="inlineError" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

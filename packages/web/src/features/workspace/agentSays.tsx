import type { ReactNode } from 'react'
import { BotAvatar } from '../bots/botAvatar'
import type { iAssistant } from './types'

// The agent speaking on a page, in the first person, with its picture: used
// for empty states and short page introductions instead of blank tables.
export function AgentSays(props: {
  bot: iAssistant | undefined
  organizationId: string | null
  children: ReactNode
  /** Suggestions or a button under the words. */
  actions?: ReactNode
  quiet?: boolean
}) {
  return (
    <div className={`agentSays ${props.quiet ? 'is-quiet' : ''}`}>
      <BotAvatar
        bot={props.bot}
        organizationId={props.organizationId}
        size={props.quiet ? 28 : 36}
        className="agentSaysAvatar"
      />
      <div className="agentSaysBody">
        <strong>{props.bot?.name ?? 'Your agent'}</strong>
        <div className="agentSaysText">{props.children}</div>
        {props.actions && (
          <div className="agentSaysActions">{props.actions}</div>
        )}
      </div>
    </div>
  )
}

// Tap-to-ask suggestions: each fills the chat composer with a draft.
export function AskPills(props: {
  label: string
  items: Array<{ label: string; draft: string }>
  onAsk: (draft: string) => void
}) {
  return (
    <div className="askPills" role="group" aria-label={props.label}>
      {props.items.map((item) => (
        <button
          key={item.label}
          type="button"
          title={item.draft}
          onClick={() => props.onAsk(item.draft)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

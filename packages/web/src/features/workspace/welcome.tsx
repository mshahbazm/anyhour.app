import type { ReactNode } from 'react'
import { BotAvatar } from '../bots/botAvatar'
import { Briefing } from '../briefing/briefing'
import type { iMonthStats } from '../briefing/api'
import { returnSuggestions } from './hello'
import type { iBotActivity } from './useBotActivity'
import type { iTrainingTip } from './trainingTips'
import type { iAssistant } from './types'

// ready: it knows little yet · return: the briefing and ideas.
export type tGreeting = 'ready' | 'return'

interface iWelcomeProps {
  greeting: tGreeting
  business: string | null
  firstName: string
  organizationId: string | null
  assistant: iAssistant | undefined
  active: boolean
  disabled: boolean
  activity: iBotActivity | null
  stats: iMonthStats | null
  statsError: string
  /** Conversations waiting for a person. */
  needsYou: number
  canEdit: boolean
  onBotChanged: (bot: iAssistant) => void
  onSend: (message: string) => void
  knowledgeCount: number
  /** The most useful thing to teach next, if anything. */
  tip: iTrainingTip | undefined
  onTip: (tip: iTrainingTip) => void
}

function Bubble(props: {
  bot: iAssistant | undefined
  organizationId: string | null
  children: ReactNode
}) {
  return (
    <div className="message fromAssistant welcomeMessage">
      <BotAvatar
        bot={props.bot}
        organizationId={props.organizationId}
        size={30}
        className="messageAvatar"
      />
      <div className="messageBody">{props.children}</div>
    </div>
  )
}

// The AI's opening turn. Shown locally so a conversation starts instantly.
export function Welcome(props: iWelcomeProps) {
  const hi = props.firstName ? `Hi ${props.firstName}!` : 'Hi!'
  if (props.greeting === 'return') return <ReturnGreeting {...props} hi={hi} />
  // Set up, but with little to go on: one clear next step.
  return (
    <Bubble bot={props.assistant} organizationId={props.organizationId}>
      <div className="messageContent">
        <p>
          {props.knowledgeCount
            ? `${hi} I’m still reading what you gave me. While I learn, tell me anything else I should know: prices, opening hours, what makes you different.`
            : `${hi} I don’t know your business yet. Tell me about it here in a few sentences, or attach documents with the paperclip.`}
        </p>
      </div>
    </Bubble>
  )
}

// Opening the chat: what happened, then the conversation carries on.
function ReturnGreeting(props: iWelcomeProps & { hi: string }) {
  const month = props.stats
    ? new Date(`${props.stats.monthStart}T00:00:00Z`).toLocaleString(
        undefined,
        { month: 'long', timeZone: 'UTC' },
      )
    : null
  return (
    <Bubble bot={props.assistant} organizationId={props.organizationId}>
      <div className="messageContent">
        <p>
          {props.hi}{' '}
          {month ? `Here’s ${month} so far.` : 'Here’s how it’s going.'}
        </p>
      </div>
      <Briefing
        organizationId={props.organizationId}
        bot={props.assistant}
        canEdit={props.canEdit}
        stats={props.stats}
        statsError={props.statsError}
        needsYou={props.needsYou}
        newLeads={props.activity?.newLeads ?? 0}
        latestNew={props.activity?.latestNew ?? []}
        onBotChanged={props.onBotChanged}
      />
      {props.active && (
        <div className="quickReplies">
          {props.tip && (
            <button
              type="button"
              className="is-accent"
              disabled={props.disabled}
              onClick={() => props.tip && props.onTip(props.tip)}
            >
              {props.tip.label}
            </button>
          )}
          {returnSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={props.disabled}
              onClick={() => props.onSend(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </Bubble>
  )
}

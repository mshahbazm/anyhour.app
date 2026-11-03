import { MessageCircle } from 'lucide-react'
import type { iAssistant } from '../workspace/types'
import { WhatsappLink } from './whatsappLink'
import type { tWhatsappAgentsState } from './whatsappLink'

// Your own WhatsApp on Channels: each person links their own agent (an
// agent only talks to the person who created it) to talk with the AI.
export function WhatsappCard(props: {
  organizationId: string | null
  bot: iAssistant | undefined
  canManage: boolean
  agents: tWhatsappAgentsState
}) {
  const { status, available } = props.agents
  return (
    <section
      className="toolCard is-wide whatsappCard"
      aria-labelledby="tools-whatsapp"
    >
      <header>
        <span className="toolIcon" aria-hidden="true">
          <MessageCircle size={16} />
        </span>
        <h2 id="tools-whatsapp">WhatsApp</h2>
        <span
          className={`toolStatus ${status === 'Connected' ? 'is-on' : ''} ${status === 'Needs attention' ? 'is-warning' : ''}`}
        >
          {available ? status : 'Not available yet'}
        </span>
      </header>
      <p className="toolText">
        Message {props.bot?.name ?? 'your AI'} from your own WhatsApp, as you
        would here, and get alerts there. Everyone on your team links their own.
      </p>
      {props.organizationId && (
        <WhatsappLink
          organizationId={props.organizationId}
          agents={props.agents}
          name={props.bot?.name ?? 'your AI'}
          canManage={props.canManage}
        />
      )}
    </section>
  )
}

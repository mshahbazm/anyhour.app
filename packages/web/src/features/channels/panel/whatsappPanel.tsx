import { Link } from '@tanstack/react-router'
import type { iAssistant } from '../../workspace/types'
import type { iConnectionList } from '../api'
import { ConnectForm, statusLabels } from '../customerWhatsappCard'
import type { tPanelChannel } from './panelView'

// The business's WhatsApp number, beside the AI's chat:
// whether it works, how to try it, and reconnecting it when it broke.
export function WhatsappPanel(props: {
  organizationId: string
  bot: iAssistant
  connection: tPanelChannel
  canEdit: boolean
  onList: (list: iConnectionList) => void
}) {
  const { connection } = props
  const working = connection.status === 'active'
  const number = connection.phoneNumber ?? 'your WhatsApp number'
  return (
    <div className="panelScroll channelPanelBody">
      <div className="panelFacts">
        <strong>{connection.phoneNumber ?? 'Your WhatsApp number'}</strong>
        <span className={`toolStatus ${working ? 'is-on' : 'is-warning'}`}>
          {statusLabels[connection.status]}
        </span>
      </div>
      {connection.accountName && (
        <p className="toolText">{connection.accountName}</p>
      )}
      {working ? (
        <p className="toolText">
          Message <strong>{number}</strong> on WhatsApp from your phone to test
          it. {props.bot.name} answers, and the conversation shows in your
          inbox.
        </p>
      ) : (
        <>
          <p className="toolText">
            {connection.lastError ?? 'WhatsApp stopped working.'} Nobody answers
            there until it’s reconnected.
          </p>
          {props.canEdit ? (
            <ConnectForm
              organizationId={props.organizationId}
              onList={props.onList}
            />
          ) : (
            <p className="toolText">An owner or admin can reconnect it.</p>
          )}
        </>
      )}
      {props.canEdit && (
        <Link to="/channels" className="panelLink">
          Template and more in Channels
        </Link>
      )}
    </div>
  )
}

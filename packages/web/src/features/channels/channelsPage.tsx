import { Radio } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../workspace/pageHeader'
import type { iAssistant } from '../workspace/types'
import type { iConnectionList, tTeamChatProvider } from './api'
import { CustomerWhatsappCard } from './customerWhatsappCard'
import { TeamChatCard } from './teamChatCard'
import { WebsiteCard } from './websiteCard'
import { WhatsappCard } from './whatsappCard'
import type { tWhatsappAgentsState } from './whatsappLink'
import './channels.css'

interface iChannelsPageProps {
  organizationId: string | null
  /** The workspace's AI, which answers every channel. */
  bot: iAssistant | undefined
  canManage: boolean
  list: iConnectionList | null
  onList: (list: iConnectionList) => void
  onBotChanged: (bot: iAssistant) => void
  /** Opens the AI's chat with its install code beside it. */
  onInstall: () => void
  /** The person's own WhatsApp agents. */
  whatsapp: tWhatsappAgentsState
}

// Slack sends the owner back here with ?connect=…&result=…;
// it's read once, then dropped from the address.
function takeInstallResult() {
  const search = new URLSearchParams(window.location.search)
  const provider = search.get('connect')
  const result = search.get('result')
  if (!provider || !result) return null
  search.delete('connect')
  search.delete('result')
  const rest = search.toString()
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${rest ? `?${rest}` : ''}`,
  )
  return { provider: provider as tTeamChatProvider, result }
}

// Where customers reach the AI and where the owner's team reaches it.
export function ChannelsPage(props: iChannelsPageProps) {
  const { organizationId, list, onList } = props
  const [installed] = useState(takeInstallResult)
  const shared = {
    organizationId,
    canManage: props.canManage,
    list,
    onList,
  }
  const name = props.bot?.name ?? 'your AI'
  return (
    <div className="page toolsPage">
      <PageHeader
        icon={<Radio size={16} />}
        title="Channels"
        description={`Where customers and your team reach ${name}.`}
      />
      <h2 className="toolsHeading">Where customers reach you</h2>
      <WebsiteCard
        organizationId={organizationId}
        bot={props.bot}
        canManage={props.canManage}
        list={list}
        onBotChanged={props.onBotChanged}
        onInstall={props.onInstall}
      />
      <CustomerWhatsappCard {...shared} />
      <h2 className="toolsHeading">Where you reach {name}</h2>
      <WhatsappCard
        organizationId={organizationId}
        bot={props.bot}
        canManage={props.canManage}
        agents={props.whatsapp}
      />
      <TeamChatCard
        provider="slack"
        {...shared}
        bot={props.bot}
        result={installed?.provider === 'slack' ? installed.result : null}
      />
    </div>
  )
}

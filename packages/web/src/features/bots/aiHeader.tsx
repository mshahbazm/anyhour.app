import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { viewPaths } from '../workspace/paths'
import type { tAiView } from '../workspace/paths'
import type { iAssistant } from '../workspace/types'
import { BotAvatar } from './botAvatar'
import './bots.css'

interface iAiHeaderProps {
  bot: iAssistant
  organizationId: string
  view: tAiView
  /** "Website · WhatsApp"; null when customers can't reach it yet. */
  worksOn: string | null
  /** The drawer button on small screens. */
  navigation?: ReactNode
  actions?: ReactNode
}

const tabs: Array<{ view: tAiView; label: string }> = [
  { view: 'assistant', label: 'Chat' },
  { view: 'profile', label: 'Profile' },
]

// Over the AI's chat and Profile: who it is, where customers reach
// it, and its tabs.
export function AiHeader(props: iAiHeaderProps) {
  const { bot } = props
  return (
    <header className="aiHeader">
      <div className="aiHeaderRow">
        {props.navigation}
        <BotAvatar
          bot={bot}
          organizationId={props.organizationId}
          size={32}
          className="aiAvatar"
        />
        <div className="aiIdentity">
          <h1>{bot.name}</h1>
          <p className="aiWhere">{props.worksOn ?? 'Only with you'}</p>
        </div>
        {props.actions && <div className="aiActions">{props.actions}</div>}
      </div>
      <nav className="aiTabs" aria-label={`${bot.name}’s pages`}>
        {tabs.map((tab) => (
          <Link
            key={tab.view}
            to={viewPaths[tab.view]}
            activeOptions={{ exact: true }}
            aria-current={tab.view === props.view ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}

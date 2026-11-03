import { useState } from 'react'
import { InsightsPage } from '../../insights/insightsPage'
import { InstallPage } from '../../install/installPage'
import type { iInstallSighting } from '../../install/useInstalls'
import { LookSheet } from '../../tryBot/lookSettings'
import { TryStage } from '../../tryBot/tryStage'
import type { iAssistant } from '../../workspace/types'
import type { tPanelChannel, tWebsiteView } from './panelView'

const views: Array<{ id: tWebsiteView; label: string }> = [
  { id: 'preview', label: 'Preview' },
  { id: 'install', label: 'Install' },
  { id: 'insights', label: 'Insights' },
]

export interface iWebsitePanelProps {
  organizationId: string
  bot: iAssistant
  site: tPanelChannel
  view: tWebsiteView
  canEdit: boolean
  /** Sources read and learned; nothing to answer from before the first. */
  readySources: number
  /** Websites in Your business: likely places to put the chat. */
  knowledgeWebsites: string[]
  installs: iInstallSighting[]
  onView: (view: tWebsiteView) => void
  onChanged: (bot: iAssistant) => void
  onSource: (id: string) => void
}

// One website's chat beside the member's chat: try it like a visitor and
// shape its look, put it on the website, and see who visits.
export function WebsitePanel(props: iWebsitePanelProps) {
  const { bot } = props
  const [customizing, setCustomizing] = useState(false)
  // Live once the chat has actually loaded on the owner's website.
  const live =
    bot.status === 'published' &&
    props.installs.some((item) => item.status === 'working')
  return (
    <>
      <nav className="panelViews" role="tablist" aria-label="Website chat">
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={props.view === view.id}
            onClick={() => props.onView(view.id)}
          >
            {view.id === 'install' && live ? (
              <>
                <span className="liveDot" aria-hidden="true" />
                Live
              </>
            ) : (
              view.label
            )}
          </button>
        ))}
      </nav>
      {props.view === 'install' ? (
        <div className="panelScroll">
          <InstallPage
            organizationId={props.organizationId}
            bot={bot}
            knowledgeWebsites={props.knowledgeWebsites}
            readySources={props.readySources}
            canEdit={props.canEdit}
            installs={props.installs}
            siteId={props.site.id}
            onChanged={props.onChanged}
          />
        </div>
      ) : props.view === 'insights' ? (
        <div className="panelScroll">
          <InsightsPage
            organizationId={props.organizationId}
            bot={bot}
            canEdit={props.canEdit}
            onInstall={() => props.onView('install')}
            onChanged={props.onChanged}
          />
        </div>
      ) : (
        <TryStage
          organizationId={props.organizationId}
          bot={bot}
          ready={props.readySources > 0}
          onSource={props.onSource}
          onCustomize={props.canEdit ? () => setCustomizing(true) : undefined}
        />
      )}
      <LookSheet
        open={customizing}
        onOpenChange={setCustomizing}
        organizationId={props.organizationId}
        bot={bot}
        canEdit={props.canEdit}
        onChanged={props.onChanged}
      />
    </>
  )
}

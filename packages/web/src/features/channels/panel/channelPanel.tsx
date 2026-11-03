import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { buttonVariants } from '#/components/ui/button'
import type { iAssistant } from '../../workspace/types'
import { channelLabel } from '../api'
import type { iConnectionList } from '../api'
import { channelIcons } from '../channelIcons'
import type { iPanelView, tPanelChannel } from './panelView'
import { WebsitePanel } from './websitePanel'
import type { iWebsitePanelProps } from './websitePanel'
import { WhatsappPanel } from './whatsappPanel'
import '../channels.css'
import './channelPanel.css'

interface iChannelPanelProps extends Pick<
  iWebsitePanelProps,
  'readySources' | 'knowledgeWebsites' | 'installs' | 'onChanged' | 'onSource'
> {
  organizationId: string
  bot: iAssistant
  canEdit: boolean
  /** The customer channels, in order. */
  channels: tPanelChannel[]
  view: iPanelView
  onView: (view: iPanelView) => void
  onList: (list: iConnectionList) => void
  onClose: () => void
}

// Beside the AI's chat: each channel where customers reach it, to set up
// and try while talking to it.
export function ChannelPanel(props: iChannelPanelProps) {
  const { bot, channels } = props
  const open =
    channels.find((item) => item.id === props.view.channelId) ?? channels.at(0)
  return (
    <aside
      className="knowledgeSidebar channelPanel"
      aria-label={`${bot.name}’s channels`}
    >
      <header className="channelPanelHeader">
        {channels.length > 1 ? (
          <div className="channelSwitch" role="tablist" aria-label="Channel">
            {channels.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === open?.id}
                onClick={() =>
                  props.onView({ ...props.view, channelId: item.id })
                }
              >
                {channelIcons[item.provider]}
                <span>{channelLabel(item)}</span>
              </button>
            ))}
          </div>
        ) : (
          <h2 className="channelPanelTitle">
            {open ? (
              <>
                {channelIcons[open.provider]}
                <span>{channelLabel(open)}</span>
              </>
            ) : (
              'Add a channel'
            )}
          </h2>
        )}
        <button
          type="button"
          className="iconButton"
          aria-label="Hide panel"
          title="Hide panel"
          onClick={props.onClose}
        >
          <X size={16} />
        </button>
      </header>
      {!open ? (
        <div className="panelScroll channelPanelBody">
          <p className="toolText">
            Customers can’t reach {bot.name} yet. Add your website chat or
            WhatsApp.
          </p>
          <Link
            to="/channels"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Set up a channel
          </Link>
        </div>
      ) : open.provider === 'website' ? (
        <WebsitePanel
          organizationId={props.organizationId}
          bot={bot}
          site={open}
          view={props.view.website}
          canEdit={props.canEdit}
          readySources={props.readySources}
          knowledgeWebsites={props.knowledgeWebsites}
          installs={props.installs}
          onView={(website) => props.onView({ channelId: open.id, website })}
          onChanged={props.onChanged}
          onSource={props.onSource}
        />
      ) : (
        <WhatsappPanel
          organizationId={props.organizationId}
          bot={bot}
          canEdit={props.canEdit}
          onList={props.onList}
          connection={open}
        />
      )}
    </aside>
  )
}

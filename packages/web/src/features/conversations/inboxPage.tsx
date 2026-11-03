import { useSearch } from '@tanstack/react-router'
import { Globe, Inbox, Mail, MessageCircle, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { buttonVariants } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import type { tAttentionState } from './attention'
import { formatWhen } from '../workspace/formatWhen'
import { PageHeader } from '../workspace/pageHeader'
import { PageToolbar, StatusTabs } from '../workspace/pageTabs'
import { usePagedList } from '../workspace/usePagedList'
import { inboxPath } from './api'
import { ConversationView } from './conversationView'
import type { iInboxItem, tConversationChannel, tInboxFilter } from './types'
import { visitorLabel, waitingFor } from './types'
import './conversations.css'

interface iInboxPageProps {
  organizationId: string | null
  botName: string | null
  attention: tAttentionState
  canWork: boolean
  /** Owners and admins: may save a reply's answer as a note. */
  canEdit: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  onOpenContact: (id: string) => void
  onOpenLead: (id: string) => void
  onTry: (() => void) | null
}

const filterLabels: Record<tInboxFilter, string> = {
  needsYou: 'Needs you',
  aiHandling: 'AI handling',
  closed: 'Closed',
  all: 'All',
}

export const channelIcons: Record<tConversationChannel, typeof Globe> = {
  widget: Globe,
  whatsapp: MessageCircle,
  email: Mail,
}

const channelNames: Record<tConversationChannel, string> = {
  widget: 'Website chat',
  whatsapp: 'WhatsApp',
  email: 'Email',
}

const refreshEvery = 15_000

// The shared inbox: every visitor conversation, with the ones waiting for a
// person first. Your AI does most of the work, so by default the
// owner only needs Needs you.
export function InboxPage(props: iInboxPageProps) {
  const needs = props.attention.supportCount
  // A link can open it on one filter (?filter=, from the month's numbers).
  const linked = useSearch({ strict: false }).filter
  const [filter, setFilter] = useState<tInboxFilter | null>(linked ?? null)
  // Opens on Needs you when something is waiting, otherwise on everything.
  const shown: tInboxFilter =
    filter ?? (props.attention.loaded && needs === 0 ? 'all' : 'needsYou')
  const list = usePagedList<iInboxItem>(
    props.organizationId ? inboxPath(props.organizationId, shown) : null,
  )
  const { refresh } = list
  const refreshAttention = props.attention.refresh
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, refreshEvery)
    return () => window.clearInterval(timer)
  }, [refresh])
  const selected = list.items.find((item) => item.id === props.selectedId)

  function changed() {
    void refresh()
    void refreshAttention()
  }

  return (
    <>
      <PageToolbar
        start={<span className="sr-only">Filter conversations</span>}
      >
        <StatusTabs
          label="Conversations"
          value={shown}
          onChange={setFilter}
          tabs={(Object.keys(filterLabels) as tInboxFilter[]).map((id) => ({
            id,
            label: filterLabels[id],
            count: id === 'needsYou' ? needs : undefined,
          }))}
        />
      </PageToolbar>
      <div className={`page inboxPage ${props.selectedId ? 'has-detail' : ''}`}>
        <PageHeader
          icon={<Inbox size={16} />}
          title="Inbox"
          description={`Every chat with ${props.botName ?? 'your AI'}. It answers first and hands visitors to you when they need a person.`}
        />
        {list.error && <p className="inlineError">{list.error}</p>}
        {!list.loaded ? (
          <div className="pageList">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : !list.items.length && !props.selectedId ? (
          <div className="pageEmpty">
            <span className="pageEmptyIcon">
              <Inbox size={20} />
            </span>
            <h3>
              {shown === 'needsYou'
                ? 'Nothing needs you right now'
                : 'No conversations here yet'}
            </h3>
            <p>
              {shown === 'needsYou'
                ? `When a visitor asks for a person or has a problem, ${props.botName ?? 'your AI'} hands them to you here.`
                : `Once ${props.botName ?? 'your AI'} is live on your website, every chat with a visitor shows up here.`}
            </p>
            {props.onTry && shown !== 'needsYou' && (
              <button
                type="button"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                onClick={() => props.onTry?.()}
              >
                <Play /> Try it yourself
              </button>
            )}
          </div>
        ) : (
          <div className={`splitView ${props.selectedId ? 'has-detail' : ''}`}>
            <ul className="pageList" aria-label="Conversations">
              {list.items.map((item) => (
                <InboxRow
                  key={item.id}
                  item={item}
                  botName={item.assistantName}
                  current={item.id === props.selectedId}
                  onSelect={() => props.onSelect(item.id)}
                />
              ))}
              {!list.items.length && (
                <li className="listNote">Nothing in this view.</li>
              )}
              {list.hasMore && (
                <li>
                  <button
                    type="button"
                    className="loadMore"
                    onClick={() => void list.loadMore()}
                  >
                    Load more
                  </button>
                </li>
              )}
            </ul>
            {props.selectedId && props.organizationId && (
              <ConversationView
                key={props.selectedId}
                organizationId={props.organizationId}
                conversationId={props.selectedId}
                listed={selected}
                canWork={props.canWork}
                canEdit={props.canEdit}
                onBack={() => props.onSelect(null)}
                onChanged={changed}
                onOpenContact={props.onOpenContact}
                onOpenLead={props.onOpenLead}
              />
            )}
          </div>
        )}
      </div>
    </>
  )
}

function InboxRow(props: {
  item: iInboxItem
  botName: string
  current: boolean
  onSelect: () => void
}) {
  const { item } = props
  const Channel = channelIcons[item.channel]
  const name = visitorLabel(item.contact)
  const last = item.lastMessage
  const from =
    last?.role === 'staff'
      ? 'You: '
      : last?.role === 'assistant'
        ? `${props.botName}: `
        : ''
  return (
    <li>
      <button
        type="button"
        className="listRow inboxRow"
        aria-current={props.current ? 'true' : undefined}
        onClick={props.onSelect}
      >
        <span className="listAvatar" aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="listText">
          <span className="listTop">
            <strong>{name}</strong>
            <time>{formatWhen(item.lastMessageAt ?? item.createdAt)}</time>
          </span>
          <small>{last ? `${from}${last.content}` : 'No messages yet'}</small>
          <span className="inboxTags">
            <span className="inboxChannel" title={channelNames[item.channel]}>
              <Channel size={12} aria-label={channelNames[item.channel]} />
            </span>
            {item.needsHumanSince && (
              <span className="inboxTag is-waiting">
                {waitingFor(item.needsHumanSince)}
              </span>
            )}
            {!item.needsHumanSince && item.handledBy === 'human' && (
              <span className="inboxTag">With the team</span>
            )}
          </span>
        </span>
      </button>
    </li>
  )
}

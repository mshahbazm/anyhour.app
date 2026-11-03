import { Fragment, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { ActivitySteps, hiddenActions } from './activitySteps'
import { ChatBlock } from './chatBlock'
import { MessageContent } from './messageContent'
import { BotAvatar } from '../bots/botAvatar'
import { TipPills } from './tipPills'
import type { iTrainingTip } from './trainingTips'
import type { iRuleDraftHandlers } from '../memberRules/ruleDraftCard'
import { blockOptions } from './types'
import type {
  iAssistant,
  iChatBlock,
  iWorkspaceAction,
  iWorkspaceMessage,
} from './types'

// Where a message in the shared thread was said.
const appNames = { whatsapp: 'WhatsApp', slack: 'Slack' }

interface iChatThreadProps {
  messages: iWorkspaceMessage[]
  blocks: iChatBlock[]
  actions: iWorkspaceAction[]
  busy: boolean
  bot: iAssistant | undefined
  organizationId: string | null
  intro: ReactNode
  /** The message the intro follows (the last one when the chat opened);
   * null puts it first. */
  introAfter: string | null
  onRespond: (block: iChatBlock, value: string) => void
  /** Shown under the latest finished reply when nothing else is waiting. */
  tips: iTrainingTip[]
  onTip: (tip: iTrainingTip) => void
  ruleDraft: iRuleDraftHandlers
}

export function ChatThread(props: iChatThreadProps) {
  const thread = useRef<HTMLDivElement>(null)
  const lastRole = props.messages.at(-1)?.role
  const messageCount = props.messages.length
  /** Follows the conversation until the reader scrolls up to read history. */
  const pinned = useRef(true)
  const blockAnswers = new Set(
    props.blocks.flatMap((block) => {
      const option = blockOptions(block).find(
        (item) => item.value === block.resolvedValue,
      )
      return option && 'title' in block.payload
        ? [`${block.payload.title}: ${option.label}`]
        : []
    }),
  )

  // Open at the latest message before the first paint, then stay there as
  // replies stream or late content (markdown, images) grows the thread.
  useLayoutEffect(() => {
    const content = thread.current
    const scroller = content?.closest<HTMLElement>('.chatScroll')
    if (!content || !scroller) return
    let lastTop = scroller.scrollTop
    const toEnd = () => {
      if (pinned.current) scroller.scrollTop = scroller.scrollHeight
    }
    // Only the reader scrolling up lets go. A scroll event that arrives after
    // late content grew the thread (fonts, pictures, cards) moves down or
    // stays put, and must not unpin it, or the newest card ends up hidden.
    const onScroll = () => {
      const top = scroller.scrollTop
      const gap = scroller.scrollHeight - top - scroller.clientHeight
      if (top < lastTop - 2) pinned.current = gap < 80
      else if (gap < 80) pinned.current = true
      lastTop = top
    }
    toEnd()
    const observer = new ResizeObserver(toEnd)
    observer.observe(content)
    observer.observe(scroller)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [])

  // Sending a message always brings the conversation back into view.
  useLayoutEffect(() => {
    if (lastRole !== 'user') return
    pinned.current = true
    const scroller = thread.current?.closest<HTMLElement>('.chatScroll')
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [messageCount, lastRole])

  const introAt =
    props.introAfter &&
    props.messages.some((message) => message.id === props.introAfter)
      ? props.introAfter
      : null

  return (
    <div
      ref={thread}
      className={`thread ${props.messages.length ? '' : 'is-empty'}`}
      role="log"
      aria-label="Helper conversation"
    >
      {!introAt && props.intro}
      {props.messages.map((message, index) => (
        <Fragment key={message.id}>
          {renderMessage(message, index)}
          {message.id === introAt && props.intro}
        </Fragment>
      ))}
      <div className="threadEnd" />
    </div>
  )

  function renderMessage(message: iWorkspaceMessage, index: number) {
    // Choice answers are already shown on their resolved card.
    if (message.role === 'user' && blockAnswers.has(message.content))
      return null
    if (message.role === 'user')
      return (
        <div className="message fromUser" key={message.id}>
          <div className="userBubble">{message.content}</div>
          {message.via && (
            <span className="messageVia">In {appNames[message.via]}</span>
          )}
        </div>
      )
    const blocks = props.blocks.filter(
      (block) => block.messageId === message.id,
    )
    const actions = props.actions.filter(
      (action) => action.messageId === message.id,
    )
    const running = message.status === 'running'
    const showTips =
      index === props.messages.length - 1 &&
      message.status === 'completed' &&
      !props.busy &&
      !blocks.some((block) => block.status === 'pending') &&
      // Only after the bot finished real work, never while it's just
      // talking or waiting for an answer — whatever the wording.
      actions.some(
        (action) =>
          action.status === 'completed' && !hiddenActions.has(action.name),
      ) &&
      !message.content
        .trim()
        .replace(/[)"”’*_]+$/, '')
        .endsWith('?')
    return (
      <div className="message fromAssistant" key={message.id}>
        <BotAvatar
          bot={props.bot}
          organizationId={props.organizationId}
          size={30}
          className="messageAvatar"
        />
        <div className="messageBody">
          <ActivitySteps actions={actions} live={running} />
          {message.via && (
            <span className="messageVia">In {appNames[message.via]}</span>
          )}
          {message.content ? (
            <MessageContent content={message.content} />
          ) : running ? (
            actions.length === 0 && (
              <div className="thinking" role="status">
                <span />
                <span />
                <span />
                <span className="sr-only">Thinking</span>
              </div>
            )
          ) : (
            !blocks.length && (
              <p className="messageNote">This response was interrupted.</p>
            )
          )}
          {blocks.map((block) => (
            <ChatBlock
              key={block.id}
              block={block}
              disabled={props.busy}
              onRespond={props.onRespond}
              ruleDraft={props.ruleDraft}
            />
          ))}
          {showTips && (
            <TipPills
              tips={props.tips}
              disabled={props.busy}
              onTip={props.onTip}
            />
          )}
          {message.status === 'failed' && (
            <p className="messageNote is-error">
              Stopped before finishing. Completed steps are listed above — ask
              me to check before retrying.
            </p>
          )}
        </div>
      </div>
    )
  }
}

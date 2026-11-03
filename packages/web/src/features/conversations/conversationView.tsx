import { ArrowLeft, Bot, Hand, Loader2, Send, UserRound } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '#/components/ui/sheet'
import { Skeleton } from '#/components/ui/skeleton'
import { problem } from '../workspace/api'
import { formatWhen } from '../workspace/formatWhen'
import { MessageContent } from '../workspace/messageContent'
import { getConversation, releaseConversation, sendReply } from './api'
import { ContactPanel } from './contactPanel'
import { MessageBlock } from './messageBlock'
import { NoteOfferCard } from './noteOfferCard'
import type { iInboxConversation, iInboxItem, iInboxMessage } from './types'
import { visitorLabel, waitingFor } from './types'

const pollEvery = 5_000

// WhatsApp's delivery status for what the business sent.
const deliveryLabels: Record<
  NonNullable<iInboxMessage['deliveryStatus']>,
  string
> = {
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not delivered',
}

const reasonWords = {
  asked_for_person: 'They asked for a person.',
  problem: 'They have a problem to sort out.',
  not_sure: 'It wasn’t sure how to help.',
  money: 'It’s about money, so it’s yours to decide.',
} as const

// One conversation as the team sees it: the messages, why your AI
// handed it over, a composer prefilled with its suggested reply, and the
// person behind it.
export function ConversationView(props: {
  organizationId: string
  conversationId: string
  listed: iInboxItem | undefined
  canWork: boolean
  /** Owners and admins: may save a reply's answer as a note. */
  canEdit: boolean
  onBack: () => void
  onChanged: () => void
  onOpenContact: (id: string) => void
  onOpenLead: (id: string) => void
}) {
  const { organizationId, conversationId } = props
  const [detail, setDetail] = useState<iInboxConversation | null>(null)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  // The draft fills the composer once; after that the box is the member's.
  const prefilled = useRef(false)
  const [pending, setPending] = useState<'send' | 'release' | null>(null)
  const [contactOpen, setContactOpen] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)

  const load = useCallback(async () => {
    try {
      const value = await getConversation(organizationId, conversationId)
      setDetail(value)
      setError('')
      const draft = value.conversation.handoffDraft
      if (draft && !prefilled.current) {
        prefilled.current = true
        setText((current) => current || draft)
      }
    } catch (cause) {
      setError(problem(cause, 'Couldn’t load this conversation.'))
    }
  }, [organizationId, conversationId])

  useEffect(() => {
    void load()
    // New visitor messages arrive while the member is reading.
    const timer = window.setInterval(() => {
      if (!document.hidden) void load()
    }, pollEvery)
    return () => window.clearInterval(timer)
  }, [load])

  const count = detail?.messages.length ?? 0
  useEffect(() => {
    if (count > lastCount.current)
      bottom.current?.scrollIntoView({ block: 'end' })
    lastCount.current = count
  }, [count])

  async function send() {
    const content = text.trim()
    if (!content || pending) return
    setPending('send')
    setError('')
    try {
      const sent = await sendReply(organizationId, conversationId, content)
      setText('')
      setDetail((shown) =>
        shown
          ? {
              ...shown,
              conversation: {
                ...shown.conversation,
                handledBy: 'human',
                needsHumanSince: null,
                handoffDraft: null,
              },
              // One open offer per conversation: the newest.
              messages: [
                ...shown.messages.map((item) =>
                  sent.noteOffer ? { ...item, noteOffer: null } : item,
                ),
                sent,
              ],
            }
          : shown,
      )
      props.onChanged()
    } catch (cause) {
      setError(problem(cause, 'Couldn’t send your reply. Try again.'))
    } finally {
      setPending(null)
    }
  }

  async function release() {
    setPending('release')
    setError('')
    try {
      setDetail(await releaseConversation(organizationId, conversationId))
      props.onChanged()
    } catch (cause) {
      setError(problem(cause, 'Couldn’t hand it back. Try again.'))
    } finally {
      setPending(null)
    }
  }

  const chat = detail?.conversation
  const listed = props.listed
  const contact = chat?.contact ?? listed?.contact ?? null
  const name = visitorLabel(contact)
  const botName = chat?.assistantName ?? listed?.assistantName ?? 'Your AI'
  const withTeam = chat?.handledBy === 'human'
  const summary = chat?.handoffSummary
  const waiting = chat?.needsHumanSince

  return (
    <section className="detailPane inboxDetail" aria-label="Conversation">
      <header className="detailPaneHeader">
        <button
          type="button"
          className="iconButton showNarrow"
          aria-label="Back to conversations"
          onClick={props.onBack}
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <strong>{name}</strong>
          <p>
            {waiting
              ? waitingFor(waiting)
              : withTeam
                ? 'With the team'
                : `${botName} is handling it`}
            {chat?.channel === 'whatsapp' && <> · WhatsApp</>}
            {chat && <> · {formatWhen(chat.createdAt)}</>}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setContactOpen(true)}
          aria-label={`About ${name}`}
        >
          <UserRound /> <span className="hideNarrow">Contact</span>
        </Button>
      </header>
      <div className="transcript">
        {summary && (waiting || withTeam) && (
          <div className="handoffCard">
            <div className="handoffTop">
              <Hand size={14} aria-hidden="true" />
              <strong>{botName} handed this to you</strong>
              <span>{reasonWords[summary.reason]}</span>
            </div>
            <dl>
              <dt>They want</dt>
              <dd>{summary.wants}</dd>
              {summary.known && (
                <>
                  <dt>What we know</dt>
                  <dd>{summary.known}</dd>
                </>
              )}
              {summary.nextStep && (
                <>
                  <dt>Next step</dt>
                  <dd>{summary.nextStep}</dd>
                </>
              )}
            </dl>
          </div>
        )}
        {!detail && !error && (
          <>
            <Skeleton className="h-10 w-2/3 rounded-xl" />
            <Skeleton className="ml-auto h-14 w-3/4 rounded-xl" />
          </>
        )}
        {detail?.messages.map((message) =>
          message.role === 'visitor' ? (
            <div className="transcriptRow fromVisitor" key={message.id}>
              <div className="visitorBubble">{message.content}</div>
              <span className="transcriptLabel">
                {formatWhen(message.createdAt)}
                {message.blockReply &&
                  (message.blockReply.value === 'sent'
                    ? ' · Sent with the form'
                    : ' · Tapped')}
              </span>
            </div>
          ) : (
            <div
              className={`transcriptRow fromBot ${message.role === 'staff' ? 'fromStaff' : ''}`}
              key={message.id}
            >
              <span className="transcriptLabel">
                {message.role === 'staff'
                  ? (message.staff?.name ?? 'Team')
                  : botName}
                {' · '}
                {formatWhen(message.createdAt)}
                {message.deliveryStatus && (
                  <> · {deliveryLabels[message.deliveryStatus]}</>
                )}
              </span>
              {(message.content || !message.blocks.length) && (
                <div className="botBubble">
                  <MessageContent content={message.content || '…'} />
                </div>
              )}
              {message.blocks.map((block) => (
                <MessageBlock key={block.id} block={block} />
              ))}
              {message.noteOffer && props.canEdit && chat && (
                <NoteOfferCard
                  organizationId={organizationId}
                  assistantId={chat.assistantId}
                  conversationId={conversationId}
                  messageId={message.id}
                  offer={message.noteOffer}
                  onDone={() =>
                    setDetail((shown) =>
                      shown
                        ? {
                            ...shown,
                            messages: shown.messages.map((item) =>
                              item.id === message.id
                                ? { ...item, noteOffer: null }
                                : item,
                            ),
                          }
                        : shown,
                    )
                  }
                />
              )}
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>
      {error && <p className="inlineError inboxError">{error}</p>}
      {props.canWork && detail && (
        <div className="inboxComposer">
          <textarea
            className="textField"
            aria-label={`Reply to ${name}`}
            rows={3}
            maxLength={4000}
            value={text}
            placeholder={`Reply to ${name}…`}
            disabled={pending !== null}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
                void send()
            }}
          />
          {chat?.handoffDraft && text === chat.handoffDraft && (
            <small className="fieldNote">
              {botName} suggested this reply. Edit it or send it as it is.
            </small>
          )}
          <div className="inboxActions">
            <Button
              size="sm"
              disabled={!text.trim() || pending !== null}
              onClick={() => void send()}
            >
              {pending === 'send' ? <Loader2 className="spin" /> : <Send />}
              {pending === 'send' ? 'Sending…' : 'Send'}
            </Button>
            {(withTeam || waiting) && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending !== null}
                onClick={() => void release()}
              >
                <Bot />
                {pending === 'release'
                  ? 'Handing back…'
                  : `Hand back to ${botName}`}
              </Button>
            )}
          </div>
          {withTeam && (
            <small className="fieldNote">
              {botName} stays quiet here until you hand it back.
            </small>
          )}
        </div>
      )}
      <Sheet open={contactOpen} onOpenChange={setContactOpen}>
        <SheetContent className="leadSheet">
          <SheetTitle className="sr-only">About {name}</SheetTitle>
          <ContactPanel
            organizationId={organizationId}
            contactId={contact?.id ?? null}
            leadIds={chat?.leadIds ?? []}
            onOpenContact={props.onOpenContact}
            onOpenLead={props.onOpenLead}
          />
        </SheetContent>
      </Sheet>
    </section>
  )
}

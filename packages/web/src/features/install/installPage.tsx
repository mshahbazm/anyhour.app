import {
  AlertTriangle,
  Check,
  Code2,
  Globe,
  Copy,
  Mail,
  Pause,
  Plus,
  Power,
  X,
} from 'lucide-react'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { api } from '../workspace/api'
import { formatWhen } from '../workspace/formatWhen'
import { originOf, ownWebsiteOrigin } from './ownWebsite'
import { embedSnippet } from './snippet'
import type { iInstallSighting } from './useInstalls'
import type { iAssistant } from '../workspace/types'
import './install.css'

interface iInstallPageProps {
  organizationId: string | null
  bot: iAssistant | undefined
  /** Websites the bot learned from: likely places to put the chat. */
  knowledgeWebsites: string[]
  readySources: number
  canEdit: boolean
  onChanged: (bot: iAssistant) => void
  /** Where the widget has reported loading; see useInstalls. */
  installs: iInstallSighting[]
  /** Its Website chat channel: the code names the site, so moving it needs no reinstall. */
  siteId?: string | null
}

export function InstallPage(props: iInstallPageProps) {
  const bot = props.bot
  const origins = bot?.allowedOrigins ?? []
  const [website, setWebsite] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const live = bot?.status === 'published'
  const installs = props.installs
  const working = installs.filter((item) => item.status === 'working')
  const notAllowed = installs.filter((item) => item.status === 'notAllowed')
  const notLive = installs.filter((item) => item.status === 'notLive')
  const seen = new Map(working.map((item) => [item.origin, item.lastSeenAt]))
  const suggested = props.knowledgeWebsites
    .map(ownWebsiteOrigin)
    .find((origin): origin is string => !!origin && !origins.includes(origin))
  const snippet = bot
    ? embedSnippet({ botId: bot.id, siteId: props.siteId })
    : ''

  // Hands the code to whoever looks after the website, in the owner's own
  // email app, ready to send.
  const sites = origins.map(host).join(', ')
  const developerEmail = `mailto:?subject=${encodeURIComponent(
    'Please add our website chat',
  )}&body=${encodeURIComponent(
    [
      'Hi,',
      '',
      `Could you add our website chat to every page of ${sites || 'our website'}? Paste this code just before </body>, or in the site builder’s custom code setting:`,
      '',
      snippet,
      '',
      'Thank you!',
    ].join('\n'),
  )}`

  async function update(changes: Partial<iAssistant>) {
    if (!props.organizationId || !bot) return
    setPending(true)
    setError('')
    try {
      props.onChanged(
        await api<iAssistant>(
          `/api/organizations/${props.organizationId}/assistants/${bot.id}`,
          { method: 'PATCH', body: JSON.stringify(changes) },
        ),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save')
    } finally {
      setPending(false)
    }
  }

  function addOrigin(event: FormEvent, value = website) {
    event.preventDefault()
    const origin = originOf(value.trim())
    if (!origin) {
      setError('Enter a website address, like yourbusiness.com')
      return
    }
    setWebsite('')
    if (origins.includes(origin)) return
    // Adding the first website is setting it up: it goes live then, without
    // a separate step, once the bot has learned something.
    const goLive = !origins.length && !live && props.readySources > 0
    void update({
      allowedOrigins: [...origins, origin],
      ...(goLive && { status: 'published' as const }),
    })
  }

  const codeFound = installs.length > 0
  return (
    <div className="installPanel">
      <InstallStatus
        name={bot?.name ?? 'your AI'}
        live={live}
        ready={props.readySources > 0}
        working={working}
        notAllowed={notAllowed}
        notLive={notLive}
        allowed={origins}
        canEdit={props.canEdit}
        pending={pending}
        onAllow={(origin) =>
          void update({ allowedOrigins: [...new Set([...origins, origin])] })
        }
        onLive={(next) => void update({ status: next ? 'published' : 'draft' })}
      />
      {error && <p className="inlineError">{error}</p>}
      <ol className="installSteps">
        <InstallStep
          number={1}
          done={origins.length > 0}
          title="Add your website"
          description="The chat only loads on these websites, so nobody can copy it onto another site."
        >
          {origins.length > 0 && (
            <ul className="originList">
              {origins.map((origin) => (
                <li key={origin}>
                  <span
                    className={`installDot ${seen.has(origin) ? 'is-working' : ''}`}
                    title={
                      seen.has(origin)
                        ? `Chat seen here ${formatWhen(seen.get(origin))}`
                        : 'Not seen on this site yet'
                    }
                  />
                  <span>{host(origin)}</span>
                  {props.canEdit && (
                    <button
                      type="button"
                      aria-label={`Remove ${origin}`}
                      disabled={pending}
                      onClick={() =>
                        void update({
                          allowedOrigins: origins.filter(
                            (item) => item !== origin,
                          ),
                        })
                      }
                    >
                      <X size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {props.canEdit && suggested && (
            // Where the bot learned from is most likely the owner's website.
            <button
              type="button"
              className="originSuggestion"
              disabled={pending}
              onClick={(event) => addOrigin(event, suggested)}
            >
              <Globe size={16} />
              <span>
                <strong>{host(suggested)}</strong>
                <small>
                  {bot?.name ?? 'Your AI'} learned from this website
                </small>
              </span>
              <span className="originSuggestionAdd">
                <Plus size={14} /> Add
              </span>
            </button>
          )}
          {props.canEdit && (
            <form className="originForm" onSubmit={addOrigin}>
              <input
                className="textField"
                placeholder={
                  suggested || origins.length
                    ? 'Or another website'
                    : 'yourbusiness.com'
                }
                aria-label="Website address"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={pending || !website.trim()}
              >
                <Plus /> Add
              </Button>
            </form>
          )}
        </InstallStep>

        <InstallStep
          number={2}
          done={codeFound}
          title="Paste the code on your website"
          description={
            <>
              Add it just before <code>&lt;/body&gt;</code> on every page, or in
              your site builder’s “custom code” setting. It loads after your
              page does, so it won’t slow your website down.
            </>
          }
        >
          <div className="snippet">
            <div className="snippetBar">
              <span>
                <Code2 size={13} /> HTML
              </span>
              <Button
                size="sm"
                variant={copied ? 'default' : 'outline'}
                onClick={() => {
                  void navigator.clipboard.writeText(snippet).then(() => {
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 2000)
                    // Copying the code is putting it live; no separate step.
                    if (
                      props.canEdit &&
                      !live &&
                      origins.length &&
                      props.readySources
                    )
                      void update({ status: 'published' })
                  })
                }}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? 'Copied' : 'Copy code'}
              </Button>
            </div>
            <textarea
              aria-label="Embed code"
              readOnly
              spellCheck={false}
              rows={snippet.split('\n').length}
              value={snippet}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
          {bot && (
            <a className="snippetSend" href={developerEmail}>
              <Mail size={14} />
              Send the code to my web developer
            </a>
          )}
          {bot && (
            <p className="installNote">
              On WordPress? Install the Anyhour plugin and enter your AI’s id:{' '}
              <code>{bot.id}</code>
            </p>
          )}
        </InstallStep>
      </ol>
    </div>
  )
}

function InstallStep(props: {
  number: number
  done: boolean
  title: string
  description: ReactNode
  children?: ReactNode
}) {
  return (
    <li className={`installStep ${props.done ? 'is-done' : ''}`}>
      <span className="stepNumber" aria-hidden="true">
        {props.done ? <Check size={13} strokeWidth={3} /> : props.number}
      </span>
      <div className="stepBody">
        <h3>
          {props.title}
          {props.done && <span className="sr-only"> (done)</span>}
        </h3>
        <p>{props.description}</p>
        {props.children}
      </div>
    </li>
  )
}

const host = (origin: string) => origin.replace(/^https?:\/\//, '')

// Is the chat on the owner's website? Read from the widget's own heartbeat,
// with the one switch that matters: live or offline.
function InstallStatus(props: {
  name: string
  live: boolean
  ready: boolean
  working: iInstallSighting[]
  notAllowed: iInstallSighting[]
  notLive: iInstallSighting[]
  allowed: string[]
  canEdit: boolean
  pending: boolean
  onAllow: (origin: string) => void
  onLive: (live: boolean) => void
}) {
  const first = props.working.at(0)
  const found = props.notLive.at(0)
  const foundAllowed = found && props.allowed.includes(found.origin)
  // Live means visitors can actually see it: switched on AND the code has
  // loaded on a page. Switched on alone is only ready to install.
  const state: { tone: string; title: string; detail: string } = props.live
    ? first
      ? {
          tone: 'is-live',
          title: `On ${props.working.map((item) => host(item.origin)).join(', ')}`,
          detail: `Answering visitors. Chat last loaded ${formatWhen(first.lastSeenAt)}.`,
        }
      : {
          tone: 'is-waiting',
          title: 'Not on your website yet',
          detail: `${props.name} is ready. Paste the code below on your site; this changes to Live once a page loads it.`,
        }
    : found
      ? {
          tone: 'is-warning',
          title: `Code found on ${host(found.origin)}`,
          detail: foundAllowed
            ? `${props.name} is offline, so visitors can’t see it there.`
            : `If this is your website, allow it so visitors can see ${props.name}.`,
        }
      : !props.allowed.length
        ? {
            tone: '',
            title: 'Not on your website yet',
            detail: `Add your website and paste the code below. ${props.name} goes live as soon as it’s set up.`,
          }
        : !props.ready
          ? {
              tone: '',
              title: `${props.name} needs to learn something first`,
              detail: 'Teach it a page or document, then turn it on.',
            }
          : {
              tone: '',
              title: 'Switched off',
              detail: `Visitors can’t see ${props.name}. Copy the code below or turn it on to go live.`,
            }
  const canTurnOn = props.ready && props.allowed.length > 0

  return (
    <div className="installStatus">
      <section className={`statusCard ${state.tone}`} aria-live="polite">
        <div className="statusTop">
          <span
            className={`statusPill ${props.live && first ? 'is-live' : props.live ? 'is-ready' : ''}`}
          >
            <span className="statusDot" aria-hidden="true" />
            {props.live ? (first ? 'Live' : 'Not installed') : 'Offline'}
          </span>
          {props.canEdit &&
            (found && !foundAllowed ? (
              <Button
                size="sm"
                disabled={props.pending}
                onClick={() => props.onAllow(found.origin)}
              >
                Allow {host(found.origin)}
              </Button>
            ) : props.live ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={props.pending}
                onClick={() => props.onLive(false)}
              >
                <Pause /> Pause
              </Button>
            ) : (
              canTurnOn && (
                <Button
                  size="sm"
                  disabled={props.pending}
                  onClick={() => props.onLive(true)}
                >
                  <Power /> Turn on
                </Button>
              )
            ))}
        </div>
        <strong>{state.title}</strong>
        <p>{state.detail}</p>
      </section>
      {props.notAllowed.map((item) => (
        <p key={item.origin} className="statusNote">
          <AlertTriangle size={15} />
          <span>
            <strong>Found on {host(item.origin)}, but it isn’t allowed</strong>
            The chat won’t load there until you allow it. Only allow websites
            you own — anyone can copy the code onto their site.
          </span>
          {props.canEdit && (
            <Button
              size="sm"
              variant="outline"
              disabled={props.pending}
              onClick={() => props.onAllow(item.origin)}
            >
              Allow
            </Button>
          )}
        </p>
      ))}
    </div>
  )
}

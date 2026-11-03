import { Code2, Globe } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { originOf } from '../install/ownWebsite'
import { updateAssistant } from '../bots/api'
import { problem } from '../workspace/api'
import type { iAssistant } from '../workspace/types'
import { channelLabel } from './api'
import type { iConnection, iConnectionList } from './api'

const installLabels: Record<
  NonNullable<iConnection['installStatus']> | 'none',
  string
> = {
  working: 'Live',
  notAllowed: 'Not allowed',
  notLive: 'Offline',
  none: 'Not installed yet',
}

// Website chat: one channel per website, answered by the AI. Adding a site
// adds it to the AI's allowed websites.
export function WebsiteCard(props: {
  organizationId: string | null
  bot: iAssistant | undefined
  canManage: boolean
  list: iConnectionList | null
  /** The AI changed (its websites); reload the channels too. */
  onBotChanged: (bot: iAssistant) => void
  /** Opens the AI's chat with its install code beside it. */
  onInstall: () => void
}) {
  const sites =
    props.list?.connections.filter((item) => item.provider === 'website') ?? []
  const live = sites.filter((item) => item.installStatus === 'working').length
  return (
    <section className="toolCard is-wide" aria-labelledby="channels-website">
      <header>
        <span className="toolIcon" aria-hidden="true">
          <Globe size={16} />
        </span>
        <h2 id="channels-website">Website chat</h2>
        {props.list && (
          <span className={`toolStatus ${live ? 'is-on' : ''}`}>
            {live
              ? `Live on ${live}`
              : sites.length
                ? 'Not installed yet'
                : 'Not set up'}
          </span>
        )}
      </header>
      {!props.list ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : (
        <>
          {!sites.length && (
            <p className="toolText">
              {props.bot?.name ?? 'Your AI'} answers visitors in a chat on your
              website.
            </p>
          )}
          {sites.length > 0 && props.organizationId && (
            <ul className="connectionList">
              {sites.map((site) => (
                <li key={site.id} className="connectionRow channelRow">
                  <span className="connectionText">
                    <strong>{channelLabel(site)}</strong>
                    <small>{installLabels[site.installStatus ?? 'none']}</small>
                  </span>
                  <Button variant="outline" size="sm" onClick={props.onInstall}>
                    <Code2 /> Install
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {props.canManage && props.organizationId && props.bot && (
            <AddWebsite
              organizationId={props.organizationId}
              bot={props.bot}
              sites={sites}
              onChanged={props.onBotChanged}
            />
          )}
        </>
      )}
    </section>
  )
}

function AddWebsite(props: {
  organizationId: string
  bot: iAssistant
  sites: iConnection[]
  onChanged: (bot: iAssistant) => void
}) {
  const [website, setWebsite] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const { bot } = props

  async function add(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    const origin = originOf(website.trim())
    if (!origin) {
      setError('Enter a website address, like yourbusiness.com')
      return
    }
    if (props.sites.some((site) => site.externalAccountId === origin)) {
      setError('That website is already here.')
      return
    }
    setPending(true)
    setError('')
    try {
      const origins = bot.allowedOrigins ?? []
      props.onChanged(
        await updateAssistant(props.organizationId, bot.id, {
          allowedOrigins: [...new Set([...origins, origin])],
        }),
      )
      setWebsite('')
    } catch (cause) {
      setError(problem(cause, 'Couldn’t add that website. Try again.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="addWebsite" onSubmit={(event) => void add(event)}>
      <Input
        inputMode="url"
        autoComplete="off"
        placeholder="yourbusiness.com"
        aria-label="Website address"
        value={website}
        onChange={(event) => setWebsite(event.target.value)}
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={!website.trim() || pending}
      >
        {pending ? 'Adding…' : 'Add website'}
      </Button>
      {error && <p className="inlineError">{error}</p>}
    </form>
  )
}

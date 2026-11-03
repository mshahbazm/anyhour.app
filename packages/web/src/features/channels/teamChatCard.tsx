import { Hash, MessagesSquare, Unplug } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { problem } from '../workspace/api'
import type { iAssistant } from '../workspace/types'
import {
  connectionChannels,
  disconnectConnection,
  startInstall,
  updateConnection,
} from './api'
import type {
  iConnection,
  iConnectionChannel,
  iConnectionList,
  tTeamChatProvider,
} from './api'

const appNames: Record<tTeamChatProvider, string> = {
  slack: 'Slack',
}

const statusLabels: Record<iConnection['status'], string> = {
  pending: 'Setting up',
  active: 'Connected',
  broken: 'Needs attention',
  disconnected: 'Removed',
}

// What each app calls the place you add us to, and how people talk to us.
const words: Record<
  tTeamChatProvider,
  { place: string; add: string; talk: string }
> = {
  slack: {
    place: 'Slack workspace',
    add: 'Add to Slack',
    talk: 'Message Anyhour in Slack, or mention @Anyhour in a channel',
  },
}

// Shown after the app sends the owner back to Channels.
export const installResults: Record<string, string> = {
  connected: 'Connected.',
  cancelled: 'Nothing changed: the install was cancelled.',
  failed: 'That didn’t work. Try again.',
  inUse: 'That one is already connected to another Anyhour workspace.',
}

function ConnectedRow(props: {
  organizationId: string
  provider: tTeamChatProvider
  connection: iConnection
  bot: iAssistant | undefined
  canManage: boolean
  onList: (list: iConnectionList) => void
  onRemoved: () => void
  onReconnect: () => void
}) {
  const { connection } = props
  const [channels, setChannels] = useState<iConnectionChannel[] | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const working = connection.status === 'active'

  useEffect(() => {
    if (!props.canManage || !working) return
    let live = true
    connectionChannels(props.organizationId, connection.id)
      .then((list) => live && setChannels(list))
      .catch(() => live && setChannels([]))
    return () => {
      live = false
    }
  }, [props.canManage, props.organizationId, connection.id, working])

  async function change(input: { alertsChannelId: string | null }) {
    setPending(true)
    setError('')
    try {
      props.onList(
        await updateConnection(props.organizationId, connection.id, input),
      )
    } catch (cause) {
      setError(problem(cause, 'Couldn’t save that. Try again.'))
    } finally {
      setPending(false)
    }
  }

  async function disconnect() {
    if (!confirm) {
      setConfirm(true)
      return
    }
    setPending(true)
    try {
      await disconnectConnection(props.organizationId, connection.id)
      props.onRemoved()
    } catch (cause) {
      setError(problem(cause, 'Couldn’t disconnect. Try again.'))
      setPending(false)
    }
  }

  const app = appNames[props.provider]
  return (
    <div className="teamChatConnection">
      <p className="toolText">
        <strong>{connection.accountName ?? words[props.provider].place}</strong>
        {' · '}
        {connection.linkedMembers === 1
          ? '1 person linked'
          : `${connection.linkedMembers} people linked`}
        {connection.youLinked ? ', you too.' : '.'}
      </p>
      {!working && (
        <p className="toolText">
          {connection.lastError ?? `${app} stopped working.`} I’m emailing
          alerts until it’s reconnected.
        </p>
      )}
      {working && props.bot && (
        <p className="toolText">
          <strong>{props.bot.name}</strong> answers you here.
        </p>
      )}
      {props.canManage && working && (
        <div className="teamChatSettings">
          <label>
            <span>
              <Hash size={13} aria-hidden="true" /> Alerts go to
            </span>
            {channels ? (
              <select
                className="textField"
                aria-label="Alerts channel"
                value={connection.alertsChannelId ?? ''}
                disabled={pending}
                onChange={(event) =>
                  void change({ alertsChannelId: event.target.value || null })
                }
              >
                <option value="">Each person, directly</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            ) : (
              <Skeleton className="h-9 rounded-md" />
            )}
          </label>
        </div>
      )}
      {!connection.youLinked && working && (
        <p className="connectionNote">
          {words[props.provider].talk}: I’ll send you a link to link your
          account.
        </p>
      )}
      {error && <p className="inlineError">{error}</p>}
      {props.canManage && (
        <div className="whatsappActions">
          {!working && (
            <Button size="sm" disabled={pending} onClick={props.onReconnect}>
              Reconnect {app}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="connectionDelete"
            disabled={pending}
            onClick={() => void disconnect()}
          >
            <Unplug /> {confirm ? 'Yes, disconnect' : 'Disconnect'}
          </Button>
        </div>
      )}
      {confirm && (
        <p className="connectionNote">
          Disconnect? I’ll leave {connection.accountName ?? app} and email
          alerts instead.
        </p>
      )}
    </div>
  )
}

// Slack: your own chat app, where your team talks to the AI. Connect it,
// choose where alerts go, see who linked, disconnect.
export function TeamChatCard(props: {
  provider: tTeamChatProvider
  organizationId: string | null
  bot: iAssistant | undefined
  canManage: boolean
  list: iConnectionList | null
  result: string | null
  onList: (list: iConnectionList) => void
}) {
  const { provider } = props
  const app = appNames[provider]
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const available = props.list?.available[provider] ?? false
  const connections =
    props.list?.connections.filter((item) => item.provider === provider) ?? []
  const name = props.bot?.name ?? 'your AI'

  async function install() {
    if (!props.organizationId) return
    setPending(true)
    setError('')
    try {
      const { url } = await startInstall(props.organizationId, provider)
      window.location.assign(url)
    } catch (cause) {
      setError(problem(cause, `Couldn’t start adding ${app}. Try again.`))
      setPending(false)
    }
  }

  const status = !props.list
    ? ''
    : !available
      ? 'Not available yet'
      : connections[0]
        ? statusLabels[connections[0].status]
        : 'Not connected'

  return (
    <section
      className="toolCard is-wide teamChatCard"
      aria-labelledby={`tools-${provider}`}
    >
      <header>
        <span className="toolIcon" aria-hidden="true">
          <MessagesSquare size={16} />
        </span>
        <h2 id={`tools-${provider}`}>{app}</h2>
        {status && (
          <span
            className={`toolStatus ${status === 'Connected' ? 'is-on' : ''} ${connections[0] && connections[0].status !== 'active' ? 'is-warning' : ''}`}
          >
            {status}
          </span>
        )}
      </header>
      {!props.list ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : !available ? (
        <p className="toolText">
          Talk to {name} in {app} and get alerts there. Not available yet.
        </p>
      ) : (
        <>
          {props.result && installResults[props.result] && (
            <p className="toolText" role="status">
              {installResults[props.result]}
            </p>
          )}
          {connections.map((connection) =>
            props.organizationId ? (
              <ConnectedRow
                key={connection.id}
                organizationId={props.organizationId}
                provider={provider}
                connection={connection}
                bot={props.bot}
                canManage={props.canManage}
                onList={props.onList}
                onRemoved={() =>
                  props.list &&
                  props.onList({
                    ...props.list,
                    connections: props.list.connections.filter(
                      (item) => item.id !== connection.id,
                    ),
                  })
                }
                onReconnect={() => void install()}
              />
            ) : null,
          )}
          {!connections.length &&
            (props.canManage ? (
              <>
                <p className="toolText">
                  Your team talks to {name} in {app}, and gets alerts there.
                </p>
                <ol className="whatsappSteps">
                  <li>
                    Tap <strong>{words[provider].add}</strong>, pick your{' '}
                    {words[provider].place} and allow it.
                  </li>
                  <li>
                    Everyone messages {name} there once to link their account.
                  </li>
                </ol>
                <Button
                  size="sm"
                  className="self-start"
                  disabled={pending}
                  onClick={() => void install()}
                >
                  {pending ? 'Opening…' : words[provider].add}
                </Button>
              </>
            ) : (
              <p className="toolText">
                Talk to {name} in {app} and get alerts there. An owner or admin
                can add it.
              </p>
            ))}
        </>
      )}
      {error && <p className="inlineError">{error}</p>}
    </section>
  )
}

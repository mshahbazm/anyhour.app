import { Loader2, Send, Unplug } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { isUnavailable, problem } from '../workspace/api'
import {
  connectWhatsapp,
  disconnectWhatsapp,
  getWhatsapp,
  testWhatsapp,
} from './api'
import type { iWhatsappAgent, iWhatsappAgents } from './api'
import './channels.css'

// How often a waiting agent checks for the member's first message.
const waitingPollMs = 10_000

export const whatsappStatusLabels: Record<iWhatsappAgent['status'], string> = {
  waiting_for_hi: 'Waiting for your hi',
  linked: 'Connected',
  broken: 'Needs attention',
}

// The person's WhatsApp agents (an agent only talks to whoever made it),
// loaded once for the shell so the lead's panel, its header and Channels
// agree.
export function useWhatsappAgents(organizationId: string | null) {
  const [state, setState] = useState<iWhatsappAgents | null>(null)
  const [available, setAvailable] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    if (!organizationId) return
    try {
      setState(await getWhatsapp(organizationId))
      setAvailable(true)
      setError('')
    } catch (cause) {
      if (isUnavailable(cause)) setAvailable(false)
      else setError(problem(cause, 'Couldn’t check WhatsApp.'))
    }
  }, [organizationId])
  useEffect(() => {
    setState(null)
    void refresh()
  }, [refresh])
  const waiting = Boolean(
    state?.agents.some(
      (agent) => agent.mine && agent.status === 'waiting_for_hi',
    ),
  )
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => void refresh(), waitingPollMs)
    return () => clearInterval(timer)
  }, [waiting, refresh])
  const mine = state?.agents.filter((agent) => agent.mine) ?? []
  const status = mine.some((agent) => agent.status === 'linked')
    ? 'Connected'
    : mine.some((agent) => agent.status === 'broken')
      ? 'Needs attention'
      : mine.length
        ? 'Waiting for your hi'
        : 'Not connected'
  return { state, setState, available, error, refresh, status }
}
export type tWhatsappAgentsState = ReturnType<typeof useWhatsappAgents>

// Your own WhatsApp, where you talk with the AI: three steps and the key,
// then "hi" from your phone.
export function WhatsappLink(props: {
  organizationId: string
  agents: tWhatsappAgentsState
  /** The AI's name. */
  name: string
  canManage: boolean
}) {
  const { organizationId, agents } = props
  const { state, setState } = agents
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const { name } = props

  const mine = state?.agents.filter((agent) => agent.mine) ?? []
  const team = state?.agents.filter((agent) => !agent.mine) ?? []
  const working = mine.filter((agent) => agent.status !== 'broken')
  const showForm = !working.length

  async function run(action: () => Promise<void>, failure: string) {
    setPending(true)
    setError('')
    setNote('')
    try {
      await action()
    } catch (cause) {
      setError(problem(cause, failure))
    } finally {
      setPending(false)
    }
  }

  function connect(event: FormEvent) {
    event.preventDefault()
    if (!token.trim() || pending) return
    void run(async () => {
      setState(await connectWhatsapp(organizationId, { token: token.trim() }))
      setToken('')
    }, 'Couldn’t connect WhatsApp. Try again.')
  }

  function remove(agent: iWhatsappAgent) {
    if (confirmRemove !== agent.id) {
      setConfirmRemove(agent.id)
      return
    }
    void run(async () => {
      await disconnectWhatsapp(organizationId, agent.id)
      setConfirmRemove(null)
      await agents.refresh()
    }, 'Couldn’t disconnect. Try again.')
  }

  if (!agents.available)
    return <p className="toolText">WhatsApp isn’t available yet.</p>
  if (!state && !agents.error) return <Skeleton className="h-24 rounded-xl" />
  return (
    <>
      {mine.length > 0 && (
        <ul className="connectionList">
          {mine.map((agent) => (
            <li className="connectionRow agentRow" key={agent.id}>
              <div className="connectionText">
                <strong>{name} answers you here</strong>
                <span>
                  {whatsappStatusLabels[agent.status]}
                  {agent.status === 'broken' &&
                    ' · paste the agent’s new key to fix it'}
                </span>
              </div>
              {agent.status === 'waiting_for_hi' && (
                <span className="agentWaiting" role="status">
                  <Loader2
                    size={14}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                  Send your agent “hi” in WhatsApp
                </span>
              )}
              <div className="whatsappActions">
                {agent.status === 'linked' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      void run(async () => {
                        await testWhatsapp(organizationId, agent.id)
                        setNote('Sent. Check WhatsApp on your phone.')
                      }, 'Couldn’t send the test. Try again.')
                    }
                  >
                    <Send /> Send me a test
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="connectionDelete"
                  disabled={pending}
                  onClick={() => remove(agent)}
                >
                  <Unplug />{' '}
                  {confirmRemove === agent.id
                    ? 'Yes, disconnect'
                    : 'Disconnect'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className="connectionNote" role="status">
          {note}
        </p>
      )}
      {showForm && (
        <>
          <ol className="whatsappSteps">
            <li>
              On your phone, open WhatsApp <strong>Settings → Agents</strong>{' '}
              and tap <strong>Create an agent</strong>. Name it {name}.
            </li>
            <li>
              Open the agent’s chat info and copy its <strong>API key</strong>.
            </li>
            <li>Paste it here, then send the agent “hi”.</li>
          </ol>
          <form className="whatsappKey" onSubmit={connect}>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Your agent’s API key"
              aria-label="Your WhatsApp agent’s API key"
              value={token}
              onChange={(event) => {
                setToken(event.target.value)
                setError('')
              }}
            />
            <Button type="submit" size="sm" disabled={pending || !token.trim()}>
              {pending ? 'Checking…' : 'Connect'}
            </Button>
          </form>
          <p className="connectionNote">
            I keep the key encrypted and never show it again. Chats with agents
            aren’t end-to-end encrypted, so never send passwords there.
          </p>
        </>
      )}
      {props.canManage && team.length > 0 && (
        <div className="connectionGroup">
          <h3 className="teamHeading">Your team</h3>
          <ul className="connectionList">
            {team.map((agent) => (
              <li className="connectionRow" key={agent.id}>
                <div className="connectionText">
                  <strong>{agent.memberName ?? 'Someone'}</strong>
                  <span>{whatsappStatusLabels[agent.status]}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="connectionDelete"
                  disabled={pending}
                  onClick={() => remove(agent)}
                >
                  <Unplug />{' '}
                  {confirmRemove === agent.id
                    ? 'Yes, disconnect'
                    : 'Disconnect'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(error || agents.error) && (
        <p className="inlineError">{error || agents.error}</p>
      )}
    </>
  )
}

import { MessageCircle, Unplug } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import { problem } from '../workspace/api'
import {
  connectWhatsappBusiness,
  disconnectConnection,
  updateConnection,
} from './api'
import type { iConnection, iConnectionList } from './api'

export const statusLabels: Record<iConnection['status'], string> = {
  pending: 'Setting up',
  active: 'Connected',
  broken: 'Needs attention',
  disconnected: 'Removed',
}

// Pasting the number's ids and token (again, to fix a broken one).
export function ConnectForm(props: {
  organizationId: string
  onList: (list: iConnectionList) => void
}) {
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [businessAccountId, setBusinessAccountId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const ready =
    phoneNumberId.trim() && businessAccountId.trim() && accessToken.trim()

  async function connect(event: FormEvent) {
    event.preventDefault()
    if (!ready || pending) return
    setPending(true)
    setError('')
    try {
      props.onList(
        await connectWhatsappBusiness(props.organizationId, {
          phoneNumberId: phoneNumberId.trim(),
          businessAccountId: businessAccountId.trim(),
          accessToken: accessToken.trim(),
        }),
      )
    } catch (cause) {
      setError(problem(cause, 'Couldn’t connect WhatsApp. Try again.'))
      setPending(false)
    }
  }

  return (
    <form className="customerWhatsappForm" onSubmit={connect}>
      <ol className="whatsappSteps">
        <li>
          In Meta’s <strong>WhatsApp Manager</strong>, open your number and copy
          its <strong>phone number id</strong> and{' '}
          <strong>WhatsApp Business Account id</strong>.
        </li>
        <li>
          In <strong>Business settings → System users</strong>, create a
          permanent <strong>access token</strong> with WhatsApp permissions.
        </li>
        <li>Paste them here.</li>
      </ol>
      <div className="customerWhatsappFields">
        <Input
          inputMode="numeric"
          autoComplete="off"
          placeholder="Phone number id"
          aria-label="Phone number id"
          value={phoneNumberId}
          onChange={(event) => setPhoneNumberId(event.target.value)}
        />
        <Input
          inputMode="numeric"
          autoComplete="off"
          placeholder="WhatsApp Business Account id"
          aria-label="WhatsApp Business Account id"
          value={businessAccountId}
          onChange={(event) => setBusinessAccountId(event.target.value)}
        />
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Access token"
          aria-label="Access token"
          value={accessToken}
          onChange={(event) => setAccessToken(event.target.value)}
        />
      </div>
      <Button
        type="submit"
        size="sm"
        className="justify-self-start"
        disabled={!ready || pending}
      >
        {pending ? 'Checking…' : 'Connect'}
      </Button>
      <p className="connectionNote">
        I keep the token encrypted and never show it again.
      </p>
      {error && <p className="inlineError">{error}</p>}
    </form>
  )
}

function ConnectedNumber(props: {
  organizationId: string
  connection: iConnection
  canManage: boolean
  onList: (list: iConnectionList) => void
  onRemoved: () => void
}) {
  const { connection } = props
  const [template, setTemplate] = useState(connection.templateName ?? '')
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const working = connection.status === 'active'

  async function change(input: { templateName: string | null }) {
    setPending(true)
    setError('')
    setSaved(false)
    try {
      props.onList(
        await updateConnection(props.organizationId, connection.id, input),
      )
      setSaved(true)
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

  return (
    <div className="teamChatConnection">
      <p className="toolText">
        <strong>{connection.phoneNumber ?? 'Your WhatsApp number'}</strong>
        {connection.accountName && <> · {connection.accountName}</>}
      </p>
      {!working && (
        <p className="toolText">
          {connection.lastError ?? 'WhatsApp stopped working.'} Customers’
          messages still reach your inbox, but nobody answers them there until
          it’s reconnected.
        </p>
      )}
      {props.canManage && working && (
        <div className="teamChatSettings">
          <form
            className="customerWhatsappTemplate"
            onSubmit={(event) => {
              event.preventDefault()
              void change({ templateName: template.trim() || null })
            }}
          >
            <label>
              <span>Template for replies after 24 hours</span>
              <Input
                autoComplete="off"
                spellCheck={false}
                placeholder="None: replies wait for you"
                aria-label="Template for replies after 24 hours"
                value={template}
                onChange={(event) => {
                  setTemplate(event.target.value)
                  setSaved(false)
                }}
              />
            </label>
            {template.trim() !== (connection.templateName ?? '') && (
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={pending}
              >
                Save
              </Button>
            )}
          </form>
        </div>
      )}
      {saved && (
        <p className="connectionNote" role="status">
          Saved.
        </p>
      )}
      {error && <p className="inlineError">{error}</p>}
      {props.canManage && !working && (
        <ConnectForm
          organizationId={props.organizationId}
          onList={props.onList}
        />
      )}
      {props.canManage && (
        <div className="whatsappActions">
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
          Disconnect? Customers who message this number won’t get answers.
        </p>
      )}
    </div>
  )
}

// The business's own WhatsApp number: customers message it and the AI
// answers, in the same inbox as the website chat.
export function CustomerWhatsappCard(props: {
  organizationId: string | null
  canManage: boolean
  list: iConnectionList | null
  onList: (list: iConnectionList) => void
}) {
  const available = props.list?.available.whatsappBusiness ?? false
  const numbers =
    props.list?.connections.filter(
      (item) => item.provider === 'whatsapp_business',
    ) ?? []
  // Customer WhatsApp through WhatsApp Business comes later; a number
  // already connected keeps working.
  const status = !props.list
    ? ''
    : numbers[0]
      ? statusLabels[numbers[0].status]
      : 'Coming later'
  const intro =
    'Your AI will answer customers who message your business’s WhatsApp number.'

  return (
    <section
      className="toolCard is-wide"
      aria-labelledby="tools-whatsapp-business"
    >
      <header>
        <span className="toolIcon" aria-hidden="true">
          <MessageCircle size={16} />
        </span>
        <h2 id="tools-whatsapp-business">WhatsApp Business</h2>
        {status && (
          <span
            className={`toolStatus ${status === 'Connected' ? 'is-on' : ''} ${numbers[0] && numbers[0].status !== 'active' ? 'is-warning' : ''}`}
          >
            {status}
          </span>
        )}
      </header>
      {!props.list ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : available && numbers.length && props.organizationId ? (
        numbers.map((connection) => (
          <ConnectedNumber
            key={connection.id}
            organizationId={props.organizationId!}
            connection={connection}
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
          />
        ))
      ) : (
        <p className="toolText">{intro}</p>
      )}
    </section>
  )
}

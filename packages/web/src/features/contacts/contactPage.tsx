import {
  ArrowLeft,
  Check,
  GitMerge,
  MessageSquareText,
  MessagesSquare,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Skeleton } from '#/components/ui/skeleton'
import { ApiError, problem } from '../workspace/api'
import { formatWhen } from '../workspace/formatWhen'
import type { iAssistant } from '../workspace/types'
import {
  addFact,
  addIdentity,
  deleteFact,
  getContact,
  mergeContact,
  removeIdentity,
  searchContacts,
  updateContact,
  updateFact,
} from './api'
import { identityIcons } from './contactsPage'
import { DealRow } from './dealRow'
import { PickerDialog } from './pickerDialog'
import type { iPickerOption } from './pickerDialog'
import type {
  iContactDetail,
  iContactFact,
  iContactIdentity,
  tContactIdentityKind,
} from './types'
import { contactLabel, identityLabels } from './types'

interface iContactPageProps {
  organizationId: string
  contactId: string
  bot: iAssistant | undefined
  canWork: boolean
  onBack: () => void
  onOpenLead: (id: string) => void
  onOpenConversation: (id: string) => void
  /** Opens the owner chat with a draft in the composer. */
  onAsk: (draft: string) => void
}

/** Another contact to merge in: picked, or offered by a 409. */
interface iMergeSource {
  id: string
  name: string
}

// One person: how to reach them, what the agent remembers, their leads and
// conversations, and what happened lately.
export function ContactPage(props: iContactPageProps) {
  const [detail, setDetail] = useState<iContactDetail | null>(null)
  const [error, setError] = useState('')
  const [pickingMerge, setPickingMerge] = useState(false)
  const [mergeSource, setMergeSource] = useState<iMergeSource | null>(null)
  const [busy, setBusy] = useState(false)
  const { organizationId, contactId } = props
  const botName = props.bot?.name ?? 'Your agent'

  const load = useCallback(async () => {
    try {
      setDetail(await getContact(organizationId, contactId))
      setError('')
    } catch (cause) {
      setError(problem(cause, 'Couldn’t open this contact. Try again.'))
    }
  }, [organizationId, contactId])

  useEffect(() => {
    void load()
  }, [load])

  const findContacts = useCallback(
    async (query: string): Promise<iPickerOption[]> =>
      (await searchContacts(organizationId, query))
        .filter((person) => person.id !== contactId)
        .map((person) => ({
          id: person.id,
          label: contactLabel(person),
          detail:
            [person.email, person.phone].filter(Boolean).join(' · ') ||
            undefined,
        })),
    [organizationId, contactId],
  )

  if (!detail)
    return (
      <div className="page contactPage">
        <BackLink onBack={props.onBack} />
        {error ? (
          <p className="inlineError">{error}</p>
        ) : (
          <>
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </>
        )}
      </div>
    )

  const { contact } = detail

  async function merge(source: iMergeSource) {
    setBusy(true)
    setError('')
    try {
      setDetail(await mergeContact(organizationId, contactId, source.id))
      setMergeSource(null)
    } catch (cause) {
      setError(problem(cause, 'Couldn’t merge those contacts. Try again.'))
      setMergeSource(null)
    } finally {
      setBusy(false)
    }
  }

  const name = contactLabel(contact)
  return (
    <div className="page contactPage">
      <BackLink onBack={props.onBack} />
      <header className="contactHead">
        <span className="contactAvatar" aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="contactHeadText">
          <NameField
            value={contact.name}
            fallback={name}
            canEdit={props.canWork}
            onSave={async (next) => {
              await updateContact(organizationId, contactId, { name: next })
              await load()
            }}
          />
        </div>
        <div className="pageHeaderActions">
          <Button
            variant="outline"
            onClick={() => props.onAsk(`What do you know about ${name}? `)}
          >
            <MessageSquareText /> Ask {botName} about {name}
          </Button>
        </div>
      </header>

      {error && (
        <p className="inlineError" role="alert">
          {error}
        </p>
      )}

      <div className="contactGrid">
        <div className="contactMain">
          <MemorySection
            organizationId={organizationId}
            contactId={contactId}
            facts={detail.facts}
            botName={botName}
            canEdit={props.canWork}
            onFacts={(facts) =>
              setDetail((current) =>
                current ? { ...current, facts } : current,
              )
            }
            onOpenConversation={props.onOpenConversation}
          />

          <section className="contactSection" aria-labelledby="contact-deals">
            <h2 id="contact-deals">Leads</h2>
            {detail.deals.length ? (
              <ul className="dealList">
                {detail.deals.map((deal) => (
                  <DealRow
                    key={deal.id}
                    deal={deal}
                    onOpen={() => props.onOpenLead(deal.id)}
                  />
                ))}
              </ul>
            ) : (
              <p className="sectionEmpty">
                No leads yet. When {name} asks for something, it shows here.
              </p>
            )}
          </section>

          <section
            className="contactSection"
            aria-labelledby="contact-conversations"
          >
            <h2 id="contact-conversations">Conversations</h2>
            {detail.conversations.length ? (
              <ul className="dealList">
                {detail.conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      className="dealRow"
                      onClick={() => props.onOpenConversation(conversation.id)}
                    >
                      <MessagesSquare size={15} className="dealIcon" />
                      <span className="dealText">
                        <strong>
                          {conversation.lastMessage?.content ||
                            'No messages yet'}
                        </strong>
                        <small>
                          With {conversation.assistantName} ·{' '}
                          {formatWhen(
                            conversation.lastMessageAt ??
                              conversation.createdAt,
                          )}
                        </small>
                      </span>
                      <Badge
                        variant={
                          conversation.status === 'open'
                            ? 'secondary'
                            : 'outline'
                        }
                      >
                        {conversation.status === 'open' ? 'Open' : 'Closed'}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sectionEmpty">No chats with {botName} yet.</p>
            )}
          </section>

          <section
            className="contactSection"
            aria-labelledby="contact-timeline"
          >
            <h2 id="contact-timeline">Recent activity</h2>
            {detail.activities.length ? (
              <ol className="contactTimeline">
                {detail.activities.map((activity) => (
                  <li
                    key={activity.id}
                    className={activity.actorMemberId ? '' : 'is-agent'}
                  >
                    <span className="timelineDot" aria-hidden="true">
                      {!activity.actorMemberId && <Sparkles size={10} />}
                    </span>
                    <div>
                      <p>{activity.title}</p>
                      <small>
                        {activity.actorMemberId ? 'Your team' : botName} ·
                        <button
                          type="button"
                          className="inlineLink"
                          onClick={() => props.onOpenLead(activity.leadId)}
                        >
                          {activity.leadTitle}
                        </button>{' '}
                        · {formatWhen(activity.createdAt)}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="sectionEmpty">Nothing has happened yet.</p>
            )}
          </section>
        </div>

        <aside className="contactSide">
          <IdentitiesSection
            organizationId={organizationId}
            contactId={contactId}
            identities={detail.identities}
            canEdit={props.canWork}
            onIdentities={(identities) =>
              setDetail((current) =>
                current ? { ...current, identities } : current,
              )
            }
            onChanged={() => void load()}
            onMerge={setMergeSource}
          />
          {props.canWork && (
            <section className="contactSection">
              <h2>Duplicates</h2>
              <p className="sectionHint">
                Same person twice? Bring the other one’s details, leads and
                memory into this contact.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() => setPickingMerge(true)}
              >
                <GitMerge /> Merge another contact into this one
              </Button>
            </section>
          )}
        </aside>
      </div>

      <PickerDialog
        open={pickingMerge}
        onOpenChange={setPickingMerge}
        title="Merge another contact"
        description={`Pick the duplicate. Everything it has moves into ${name}.`}
        placeholder="Search by name, email or phone"
        search={findContacts}
        onPick={(option) => {
          setPickingMerge(false)
          setMergeSource({ id: option.id, name: option.label })
        }}
        empty="No other contacts yet."
      />
      <Dialog
        open={Boolean(mergeSource)}
        onOpenChange={(open) => !open && setMergeSource(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Merge {mergeSource?.name} into {name}?
            </DialogTitle>
            <DialogDescription>
              Their ways to reach them, leads, conversations and memory move to{' '}
              {name}, and {mergeSource?.name} is removed. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setMergeSource(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => mergeSource && void merge(mergeSource)}
            >
              <GitMerge /> {busy ? 'Merging…' : 'Merge contacts'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BackLink(props: { onBack: () => void }) {
  return (
    <button type="button" className="backLink" onClick={props.onBack}>
      <ArrowLeft size={14} /> Contacts
    </button>
  )
}

// The name as a heading, edited in place.
function NameField(props: {
  value: string | null
  fallback: string
  canEdit: boolean
  onSave: (name: string | null) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await props.onSave(draft.trim() || null)
      setEditing(false)
    } catch (cause) {
      setError(problem(cause, 'Couldn’t save the name. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  if (editing)
    return (
      <form className="nameForm" onSubmit={save}>
        <input
          className="textField"
          autoFocus
          value={draft}
          maxLength={200}
          aria-label="Name"
          placeholder="Their name"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && setEditing(false)}
        />
        <Button type="submit" size="sm" disabled={saving}>
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
        {error && <p className="inlineError">{error}</p>}
      </form>
    )
  return (
    <h1 className="contactName">
      {props.fallback}
      {props.canEdit && (
        <button
          type="button"
          className="iconButton"
          aria-label="Edit name"
          onClick={() => {
            setDraft(props.value ?? '')
            setEditing(true)
          }}
        >
          <Pencil size={14} />
        </button>
      )}
    </h1>
  )
}

function IdentitiesSection(props: {
  organizationId: string
  contactId: string
  identities: iContactIdentity[]
  canEdit: boolean
  onIdentities: (identities: iContactIdentity[]) => void
  /** A change that moves the display email or phone. */
  onChanged: () => void
  onMerge: (source: iMergeSource) => void
}) {
  const [kind, setKind] = useState<tContactIdentityKind>('email')
  const [value, setValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Someone else already has what was typed.
  const [taken, setTaken] = useState<iMergeSource | null>(null)

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!value.trim()) return
    setSaving(true)
    setError('')
    setTaken(null)
    try {
      const saved = await addIdentity(props.organizationId, props.contactId, {
        kind,
        value: value.trim(),
      })
      if (!props.identities.some((item) => item.id === saved.id))
        props.onIdentities([...props.identities, saved])
      setValue('')
      setAdding(false)
      props.onChanged()
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'identity_taken') {
        const id = cause.detail.contactId
        const name = cause.detail.contactName
        if (typeof id === 'string')
          setTaken({
            id,
            name: typeof name === 'string' && name ? name : 'that contact',
          })
        else setError(cause.message)
      } else if (cause instanceof ApiError && cause.status === 422)
        setError(
          kind === 'email'
            ? 'That doesn’t look like an email address.'
            : 'That doesn’t look like a phone number. Include the country code, like +44.',
        )
      else setError(problem(cause, 'Couldn’t add that. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  async function remove(identity: iContactIdentity) {
    setError('')
    setTaken(null)
    try {
      await removeIdentity(props.organizationId, props.contactId, identity.id)
      props.onIdentities(
        props.identities.filter((item) => item.id !== identity.id),
      )
      props.onChanged()
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === 'last_identity'
          ? 'A contact needs at least one way to reach them. Add another before removing this one.'
          : problem(cause, 'Couldn’t remove that. Try again.'),
      )
    }
  }

  return (
    <section className="contactSection" aria-labelledby="contact-reach">
      <h2 id="contact-reach">Ways to reach them</h2>
      <ul className="identityList">
        {props.identities.map((identity) => {
          const Icon = identityIcons[identity.kind]
          const href =
            identity.kind === 'email'
              ? `mailto:${identity.value}`
              : identity.kind === 'phone'
                ? `tel:${identity.value}`
                : `https://wa.me/${identity.value.replace(/[^\d]/g, '')}`
          return (
            <li key={identity.id} className="identityItem">
              <Icon size={14} aria-label={identityLabels[identity.kind]} />
              <a
                href={href}
                target={identity.kind === 'whatsapp' ? '_blank' : undefined}
                rel="noreferrer"
              >
                {identity.value}
              </a>
              {props.canEdit && (
                <button
                  type="button"
                  className="iconButton"
                  aria-label={`Remove ${identity.value}`}
                  onClick={() => void remove(identity)}
                >
                  <X size={13} />
                </button>
              )}
            </li>
          )
        })}
        {!props.identities.length && (
          <li className="sectionEmpty">No way to reach them yet.</li>
        )}
      </ul>
      {taken && (
        <div className="takenNote" role="alert">
          <p>{taken.name} already has this. They may be the same person.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.onMerge(taken)}
          >
            <GitMerge /> Merge with {taken.name}
          </Button>
        </div>
      )}
      {error && <p className="inlineError">{error}</p>}
      {props.canEdit &&
        (adding ? (
          <form className="identityForm" onSubmit={add}>
            <select
              className="textField"
              aria-label="Kind"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as tContactIdentityKind)
              }
            >
              {(['email', 'phone', 'whatsapp'] as const).map((item) => (
                <option key={item} value={item}>
                  {identityLabels[item]}
                </option>
              ))}
            </select>
            <input
              className="textField"
              autoFocus
              value={value}
              maxLength={320}
              aria-label={identityLabels[kind]}
              type={kind === 'email' ? 'email' : 'tel'}
              placeholder={
                kind === 'email' ? 'name@example.com' : '+44 7700 900123'
              }
              onChange={(event) => setValue(event.target.value)}
            />
            <div className="identityFormActions">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAdding(false)
                  setTaken(null)
                  setError('')
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saving || !value.trim()}
              >
                Add
              </Button>
            </div>
          </form>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => setAdding(true)}
          >
            <Plus /> Add a way to reach them
          </Button>
        ))}
    </section>
  )
}

function MemorySection(props: {
  organizationId: string
  contactId: string
  facts: iContactFact[]
  botName: string
  canEdit: boolean
  onFacts: (facts: iContactFact[]) => void
  onOpenConversation: (id: string) => void
}) {
  const [text, setText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    setSaving(true)
    setError('')
    try {
      const saved = await addFact(
        props.organizationId,
        props.contactId,
        text.trim(),
      )
      props.onFacts([saved, ...props.facts])
      setText('')
    } catch (cause) {
      setError(problem(cause, 'Couldn’t save that. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  async function save(fact: iContactFact) {
    if (!draft.trim()) return
    setSaving(true)
    setError('')
    try {
      const saved = await updateFact(
        props.organizationId,
        props.contactId,
        fact.id,
        draft.trim(),
      )
      props.onFacts(
        props.facts.map((item) => (item.id === saved.id ? saved : item)),
      )
      setEditingId(null)
    } catch (cause) {
      setError(problem(cause, 'Couldn’t save that. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  async function remove(fact: iContactFact) {
    setError('')
    try {
      await deleteFact(props.organizationId, props.contactId, fact.id)
      props.onFacts(props.facts.filter((item) => item.id !== fact.id))
    } catch (cause) {
      setError(problem(cause, 'Couldn’t delete that. Try again.'))
    }
  }

  return (
    <section className="contactSection" aria-labelledby="contact-memory">
      <h2 id="contact-memory">What {props.botName} remembers</h2>
      {props.facts.length ? (
        <ul className="factList">
          {props.facts.map((fact) =>
            editingId === fact.id ? (
              <li key={fact.id} className="factItem is-editing">
                <textarea
                  className="textField"
                  rows={2}
                  autoFocus
                  value={draft}
                  maxLength={500}
                  aria-label="Edit memory"
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="factActions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={saving || !draft.trim()}
                    onClick={() => void save(fact)}
                  >
                    <Check /> Save
                  </Button>
                </div>
              </li>
            ) : (
              <li key={fact.id} className="factItem">
                <p>{fact.text}</p>
                <div className="factMeta">
                  {fact.source === 'agent' ? (
                    <span className="factSource">
                      <Sparkles size={12} /> Learned by {props.botName}
                      {fact.conversationId && (
                        <>
                          {' · '}
                          <button
                            type="button"
                            className="inlineLink"
                            onClick={() =>
                              fact.conversationId &&
                              props.onOpenConversation(fact.conversationId)
                            }
                          >
                            See chat
                          </button>
                        </>
                      )}
                    </span>
                  ) : (
                    <span className="factSource">Added by your team</span>
                  )}
                  <time>{formatWhen(fact.updatedAt)}</time>
                  {props.canEdit && (
                    <span className="factTools">
                      <button
                        type="button"
                        className="iconButton"
                        aria-label="Edit"
                        onClick={() => {
                          setDraft(fact.text)
                          setEditingId(fact.id)
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="iconButton"
                        aria-label="Delete"
                        onClick={() => void remove(fact)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="sectionEmpty">
          Nothing yet. {props.botName} notes useful details from chats, like
          preferences or the best time to call. You can add your own too.
        </p>
      )}
      {error && <p className="inlineError">{error}</p>}
      {props.canEdit && (
        <form className="noteForm" onSubmit={add}>
          <textarea
            className="textField"
            rows={2}
            value={text}
            maxLength={500}
            placeholder="Add something to remember, like “Prefers WhatsApp”"
            aria-label="New memory"
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={saving || !text.trim()}>
            Remember
          </Button>
        </form>
      )}
    </section>
  )
}

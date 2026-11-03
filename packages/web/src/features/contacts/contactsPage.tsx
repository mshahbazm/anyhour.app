import { Mail, MessageCircle, Phone, Plus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { formatWhen } from '../workspace/formatWhen'
import { PageHeader } from '../workspace/pageHeader'
import { PageToolbar } from '../workspace/pageTabs'
import { usePagedList } from '../workspace/usePagedList'
import type { iAssistant } from '../workspace/types'
import { AddContactDialog } from './addContactDialog'
import { contactsPath } from './api'
import { ContactPage } from './contactPage'
import type { iContactListItem, tContactIdentityKind } from './types'
import { contactLabel, identityLabels } from './types'
import './contacts.css'

interface iContactsPageProps {
  organizationId: string | null
  bot: iAssistant | undefined
  /** Everyone in the workspace can keep contacts up to date. */
  canWork: boolean
  /** The contact open from the address. */
  contactId: string | null
  onOpenContact: (id: string | null) => void
  onOpenLead: (id: string) => void
  onOpenConversation: (id: string) => void
  /** Opens the owner chat with a draft in the composer. */
  onAsk: (draft: string) => void
}

export const identityIcons: Record<tContactIdentityKind, typeof Mail> = {
  email: Mail,
  phone: Phone,
  whatsapp: MessageCircle,
}

/** The search, a moment after the last key, so each key isn't a request. */
function useSettled(value: string, delay = 250) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return settled
}

// The people the business talks to.
export function ContactsPage(props: iContactsPageProps) {
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const settled = useSettled(query)
  const people = usePagedList<iContactListItem>(
    props.organizationId && !props.contactId
      ? contactsPath(props.organizationId, settled)
      : null,
  )
  const botName = props.bot?.name ?? 'your agent'

  if (props.contactId && props.organizationId)
    return (
      <ContactPage
        key={props.contactId}
        organizationId={props.organizationId}
        contactId={props.contactId}
        bot={props.bot}
        canWork={props.canWork}
        onBack={() => props.onOpenContact(null)}
        onOpenLead={props.onOpenLead}
        onOpenConversation={props.onOpenConversation}
        onAsk={props.onAsk}
      />
    )

  const searching = Boolean(settled.trim())
  const nothing = people.loaded && !people.items.length && !searching

  return (
    <>
      {!nothing && (
        <PageToolbar
          search={{
            value: query,
            placeholder: 'Search people',
            onChange: setQuery,
          }}
        />
      )}
      <div className="page">
        <PageHeader
          icon={<Users size={16} />}
          title="People"
          description={`Everyone who has reached you, with the ways to reach them back and what ${botName} remembers about them.`}
          actions={
            props.canWork && (
              <Button onClick={() => setAdding(true)}>
                <Plus /> Add contact
              </Button>
            )
          }
        />
        {people.error && <p className="inlineError">{people.error}</p>}
        {!people.loaded ? (
          <div className="pageList">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : nothing ? (
          <div className="pageEmpty">
            <span className="pageEmptyIcon">
              <Users size={20} />
            </span>
            <h3>Your contacts gather here</h3>
            <p>
              When a visitor shares an email or phone number with {botName},
              they become a contact. Each one keeps their leads, conversations
              and what {botName} learns about them in one place.
            </p>
            {props.canWork && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAdding(true)}
              >
                <Plus /> Add someone yourself
              </Button>
            )}
          </div>
        ) : (
          <ul className="pageList" aria-label="People">
            {people.items.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  className="listRow"
                  onClick={() => props.onOpenContact(person.id)}
                >
                  <span className="listAvatar" aria-hidden="true">
                    {contactLabel(person).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="listText">
                    <span className="listTop">
                      <strong>{contactLabel(person)}</strong>
                      <time>
                        {formatWhen(person.lastActivityAt ?? person.createdAt)}
                      </time>
                    </span>
                    <small>
                      {person.openDealCount
                        ? `${person.openDealCount} ${person.openDealCount === 1 ? 'lead' : 'leads'} open`
                        : 'No open leads'}
                    </small>
                  </span>
                  <span className="reachIcons">
                    {(['email', 'phone', 'whatsapp'] as const)
                      .filter((kind) => person.identityKinds.includes(kind))
                      .map((kind) => {
                        const Icon = identityIcons[kind]
                        return (
                          <Icon
                            key={kind}
                            size={14}
                            aria-label={identityLabels[kind]}
                          />
                        )
                      })}
                  </span>
                </button>
              </li>
            ))}
            {!people.items.length && (
              <li className="listNote">Nobody matches your search.</li>
            )}
          </ul>
        )}
        {people.loaded && people.hasMore && (
          <button
            type="button"
            className="loadMore"
            onClick={() => void people.loadMore()}
          >
            Load more
          </button>
        )}
        {props.organizationId && (
          <AddContactDialog
            open={adding}
            onOpenChange={setAdding}
            organizationId={props.organizationId}
            onOpenContact={(id) => {
              void people.refresh()
              props.onOpenContact(id)
            }}
          />
        )}
      </div>
    </>
  )
}

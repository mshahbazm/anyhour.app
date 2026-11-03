import { useSearch } from '@tanstack/react-router'
import { ChevronDown, Mail, MessagesSquare, Phone, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button, buttonVariants } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdownMenu'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import { api, problem } from '../workspace/api'
import { formatWhen } from '../workspace/formatWhen'
import { PageToolbar } from '../workspace/pageTabs'
import { usePagedList } from '../workspace/usePagedList'
import { AgentSays } from '../workspace/agentSays'
import type { iAssistant, iLead, iLeadDetail } from '../workspace/types'
import { LeadTimeline, qualificationLine } from './leadTimeline'
import { LeadPeople } from './leadPeople'
import {
  formatLeadValue,
  leadStatuses,
  statusLabels,
  StatusDot,
  StatusPill,
} from './status'
import type { tLeadStatus } from './status'
import './leads.css'

const captured: Record<iLead['capturedVia'], string> = {
  chat: 'From chat',
  manual: 'Added by team',
}

function leadName(lead: iLead) {
  return lead.contactName || lead.contactEmail || lead.contactPhone || 'Unknown'
}

interface iLeadsPageProps {
  organizationId: string | null
  bot: iAssistant | undefined
  onTry: (() => void) | null
  /** Everyone in the workspace: change a lead's status, add notes. */
  canWorkLeads: boolean
  /** The lead open in the side sheet, from the address. */
  openId: string | null
  onOpen: (id: string | null) => void
  onOpenConversation: (id: string) => void
  onOpenContact: (id: string) => void
  /** A lead's status changed, so counts elsewhere (the sidebar) can update. */
  onLeadsChanged: () => void
}

/** 'open': new and contacted; otherwise one status. */
type tStatusFilter = 'open' | tLeadStatus

const filters: Array<{ id: tStatusFilter; label: string }> = [
  { id: 'open', label: 'All open' },
  ...leadStatuses.map((status) => ({
    id: status,
    label: statusLabels[status],
  })),
]

export function LeadsPage(props: iLeadsPageProps) {
  // A link can open it on one status (?status=, from the month's numbers).
  const linked = useSearch({ strict: false }).status
  const [filter, setFilter] = useState<tStatusFilter>(linked ?? 'open')
  const list = usePagedList<iLead>(
    props.organizationId
      ? `/api/organizations/${props.organizationId}/leads?status=${filter}`
      : null,
  )
  const [query, setQuery] = useState('')
  const openId = props.openId
  const needle = query.trim().toLowerCase()
  const visible = list.items.filter(
    (lead) =>
      !needle ||
      `${leadName(lead)} ${lead.title} ${lead.contactEmail ?? ''}`
        .toLowerCase()
        .includes(needle),
  )
  const empty = list.loaded && !list.items.length && filter === 'open'
  return (
    <>
      {list.items.length > 0 && (
        <PageToolbar
          wraps
          search={{
            value: query,
            placeholder: 'Search leads',
            onChange: setQuery,
          }}
        />
      )}
      <div className="page">
        {list.error && <p className="inlineError">{list.error}</p>}
        {list.loaded && (
          <div className="statusChips" role="group" aria-label="Show leads">
            {filters.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
              >
                {option.id !== 'open' && <StatusDot status={option.id} />}
                {option.label}
              </button>
            ))}
          </div>
        )}
        {!list.loaded ? (
          <div className="pageList">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : empty ? (
          <AgentSays
            bot={props.bot}
            organizationId={props.organizationId}
            actions={
              props.onTry && (
                <button
                  type="button"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  onClick={() => props.onTry?.()}
                >
                  <Play /> See how I ask
                </button>
              )
            }
          >
            <p>
              No open leads. When I capture one you’ll see it here, and I’ll
              tell you what I did. Anything that needs you goes right at the
              top.
            </p>
          </AgentSays>
        ) : (
          <ul className="pageList" aria-label="Leads">
            {visible.map((lead) => (
              <li key={lead.id}>
                <button
                  type="button"
                  className="listRow"
                  onClick={() => props.onOpen(lead.id)}
                >
                  <span className="listAvatar" aria-hidden="true">
                    {leadName(lead).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="listText">
                    <span className="listTop">
                      <strong>{leadName(lead)}</strong>
                      <time>{formatWhen(lead.createdAt)}</time>
                    </span>
                    <small>
                      {lead.reason === 'question' && (
                        <span className="questionTag">Needs an answer</span>
                      )}
                      {lead.title}
                    </small>
                  </span>
                  <StatusPill status={lead.status} />
                </button>
              </li>
            ))}
            {!visible.length && (
              <li className="listNote">
                {needle
                  ? 'No leads match your search.'
                  : filter === 'open'
                    ? 'No open leads.'
                    : `No ${statusLabels[filter].toLowerCase()} leads.`}
              </li>
            )}
          </ul>
        )}
        {list.loaded && list.hasMore && (
          <button
            type="button"
            className="loadMore"
            onClick={() => void list.loadMore()}
          >
            Load more
          </button>
        )}
        <Sheet
          open={Boolean(openId)}
          onOpenChange={(open) => !open && props.onOpen(null)}
        >
          <SheetContent className="leadSheet">
            {openId && props.organizationId && (
              <LeadDetail
                organizationId={props.organizationId}
                leadId={openId}
                canWork={props.canWorkLeads}
                bot={props.bot}
                onOpenContact={props.onOpenContact}
                onChanged={(lead) => {
                  list.setItems((items) =>
                    items.map((item) =>
                      item.id === lead.id ? { ...item, ...lead } : item,
                    ),
                  )
                  props.onLeadsChanged()
                }}
                onOpenConversation={props.onOpenConversation}
              />
            )}
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}

function LeadDetail({
  organizationId,
  leadId,
  canWork,
  bot,
  onChanged,
  onOpenConversation,
  onOpenContact,
}: {
  organizationId: string
  leadId: string
  canWork: boolean
  bot: iAssistant | undefined
  onChanged: (lead: iLead) => void
  onOpenConversation: (id: string) => void
  onOpenContact: (id: string) => void
}) {
  const [detail, setDetail] = useState<iLeadDetail | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [value, setValue] = useState('')
  const [pending, setPending] = useState(false)
  const path = `/api/organizations/${organizationId}/leads/${encodeURIComponent(leadId)}`

  useEffect(() => {
    let live = true
    void api<iLeadDetail>(path)
      .then((loaded) => {
        if (live) {
          setDetail(loaded)
          setValue(
            loaded.lead.value === null ? '' : String(loaded.lead.value / 100),
          )
        }
      })
      .catch((cause) => {
        if (live)
          setError(problem(cause, 'Couldn’t open this lead. Try again.'))
      })
    return () => {
      live = false
    }
  }, [path])

  async function save(
    change: { status?: tLeadStatus; value?: number | null },
    failure: string,
  ) {
    setPending(true)
    setError('')
    try {
      const lead = await api<iLead>(path, {
        method: 'PATCH',
        body: JSON.stringify(change),
      })
      setDetail((current) =>
        current ? { ...current, lead: { ...current.lead, ...lead } } : current,
      )
      onChanged(lead)
    } catch (cause) {
      setError(problem(cause, failure))
    } finally {
      setPending(false)
    }
  }

  // The value is typed as a plain amount and kept in minor units.
  function saveValue(event: FormEvent) {
    event.preventDefault()
    const amount = value.trim() ? Number(value.replace(/,/g, '')) : null
    if (amount !== null && !(amount >= 0)) {
      setError('Enter the value as a number, like 1250 or 1250.50.')
      return
    }
    void save(
      { value: amount === null ? null : Math.round(amount * 100) },
      'Couldn’t save the value. Try again.',
    )
  }

  async function addNote(event: FormEvent) {
    event.preventDefault()
    if (!note.trim()) return
    setPending(true)
    setError('')
    try {
      const saved = await api<iLeadDetail['notes'][number]>(`${path}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: note.trim() }),
      })
      setDetail((current) =>
        current ? { ...current, notes: [...current.notes, saved] } : current,
      )
      setNote('')
    } catch (cause) {
      setError(problem(cause, 'Couldn’t save the note. Try again.'))
    } finally {
      setPending(false)
    }
  }

  if (!detail)
    return (
      <div className="leadDetail">
        <SheetTitle className="sr-only">Lead</SheetTitle>
        {error ? (
          <p className="inlineError">{error}</p>
        ) : (
          <>
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-20 w-full" />
          </>
        )}
      </div>
    )

  const { lead, contact } = detail
  const qualified = qualificationLine(lead)
  return (
    <div className="leadDetail">
      <SheetHeader className="p-0">
        <SheetTitle className="text-base">
          {contact.name || contact.email || contact.phone || 'Unknown visitor'}
        </SheetTitle>
        {qualified && (
          <p
            className="qualificationLine"
            title={lead.qualification?.reasoning ?? undefined}
          >
            {qualified}
          </p>
        )}
        {lead.reason === 'question' && (
          <p className="questionNote">
            {bot?.name ?? 'Your agent'} couldn’t answer this visitor, so it took
            their details for a person to reply. Teaching it the answer stops it
            happening again.
          </p>
        )}
        <SheetDescription>
          {lead.title} · {captured[lead.capturedVia]} ·{' '}
          {formatWhen(lead.createdAt)}
        </SheetDescription>
      </SheetHeader>
      {error && <p className="inlineError">{error}</p>}
      <div className="contactCard">
        {contact.email && (
          <a href={`mailto:${contact.email}`}>
            <Mail size={14} /> {contact.email}
          </a>
        )}
        {contact.phone && (
          <a href={`tel:${contact.phone}`}>
            <Phone size={14} /> {contact.phone}
          </a>
        )}
        {!contact.email && !contact.phone && (
          <span className="mutedLine">No contact details shared.</span>
        )}
      </div>
      {lead.summary && (
        <section className="detailSection">
          <h4>What they need</h4>
          <p className="leadSummary">{lead.summary}</p>
        </section>
      )}
      <section className="detailSection">
        <h4>Status</h4>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!canWork || pending}
            render={
              <button
                type="button"
                className="statusTrigger"
                aria-label="Lead status"
              />
            }
          >
            <StatusPill status={lead.status} />
            <ChevronDown size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuRadioGroup
              value={lead.status}
              onValueChange={(next) => {
                const status = leadStatuses.find((item) => item === next)
                if (status && status !== lead.status)
                  void save(
                    { status },
                    'Couldn’t change the status. Try again.',
                  )
              }}
            >
              {leadStatuses.map((status) => (
                <DropdownMenuRadioItem key={status} value={status} closeOnClick>
                  <StatusDot status={status} />
                  {statusLabels[status]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </section>
      {lead.status === 'won' && (
        <section className="detailSection">
          <h4>Value</h4>
          {canWork ? (
            <form className="valueForm" onSubmit={saveValue}>
              <Input
                inputMode="decimal"
                aria-label="Value"
                placeholder="0"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={pending}
              >
                Save
              </Button>
            </form>
          ) : (
            <p>{lead.value === null ? '—' : formatLeadValue(lead.value)}</p>
          )}
        </section>
      )}
      <LeadPeople
        organizationId={organizationId}
        leadId={lead.id}
        people={detail.contacts}
        canWork={canWork}
        onPeople={(people) => {
          setDetail((shown) => (shown ? { ...shown, contacts: people } : shown))
          onChanged({ ...lead, contacts: people })
        }}
        onOpenContact={onOpenContact}
      />
      <LeadTimeline organizationId={organizationId} leadId={lead.id} />
      {detail.conversationIds.length > 0 && (
        <section className="detailSection">
          <h4>Conversations</h4>
          {detail.conversationIds.map((id, index) => (
            <Button
              key={id}
              variant="outline"
              size="sm"
              className="justify-start"
              onClick={() => onOpenConversation(id)}
            >
              <MessagesSquare /> Read conversation{' '}
              {detail.conversationIds.length > 1 ? index + 1 : ''}
            </Button>
          ))}
        </section>
      )}
      <section className="detailSection">
        <h4>Notes</h4>
        {detail.notes.map((item) => (
          <div className="noteItem" key={item.id}>
            <p>{item.body}</p>
            <time>{formatWhen(item.createdAt)}</time>
          </div>
        ))}
        {canWork && (
          <form className="noteForm" onSubmit={addNote}>
            <textarea
              className="textField"
              rows={3}
              placeholder="Add a note for your team…"
              aria-label="New note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={pending || !note.trim()}>
              Add note
            </Button>
          </form>
        )}
      </section>
    </div>
  )
}

import {
  ArrowRightLeft,
  BellRing,
  ChevronDown,
  Circle,
  Inbox,
  Sparkles,
  StickyNote,
  UserPlus,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Skeleton } from '#/components/ui/skeleton'
import { isUnavailable, problem } from '../workspace/api'
import { formatWhen } from '../workspace/formatWhen'
import type { iLead } from '../workspace/types'
import { listLeadActivity } from './api'
import type { iLeadActivity } from './api'

const intentWords: Record<NonNullable<iLead['intent']>, string> = {
  buy: 'wants to buy',
  enquire: 'has a question',
  support: 'needs help',
  spam: 'looks like spam',
}
const fitWords = {
  strong: 'strong fit',
  possible: 'possible fit',
  poor: 'poor fit',
} as const

/** "Scored 82 · strong fit · wants to buy", or null before qualification. */
export function qualificationLine(lead: iLead) {
  const parts = [
    typeof lead.score === 'number' ? `Scored ${lead.score}` : null,
    lead.qualification?.fit ? fitWords[lead.qualification.fit] : null,
    lead.intent ? intentWords[lead.intent] : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

function KindIcon(props: { kind: string }) {
  const size = 14
  const icons: Record<string, ReactNode> = {
    captured: <UserPlus size={size} />,
    status_changed: <ArrowRightLeft size={size} />,
    note_added: <StickyNote size={size} />,
    email_received: <Inbox size={size} />,
    owner_notified: <BellRing size={size} />,
    qualified: <Sparkles size={size} />,
  }
  return (
    <span className="timelineIcon">
      {icons[props.kind] ?? <Circle size={10} />}
    </span>
  )
}

/**
 * An activity title without machine codes the server sometimes appends, such
 * as "(validation_error)": owners read sentences, not enum values.
 */
export function readableTitle(title: string) {
  return title
    .replace(/\s*\((?:[a-z]+_)+[a-z]+\)/g, '')
    .replace(/\s+([.,:;])/g, '$1')
    .trim()
}

// The parts of an activity's detail worth reading, in plain words.
const detailLabels: Array<[string, string]> = [
  ['summary', 'Summary'],
  ['reasoning', 'Why'],
  ['conditionReasoning', 'Why'],
  ['reason', 'Why'],
  ['condition', 'Condition'],
  ['outcome', 'Outcome'],
  ['subject', 'Subject'],
  ['body', 'Message'],
  ['error', 'What went wrong'],
]
function detailLines(detail: Record<string, unknown> | null, title: string) {
  if (!detail) return []
  const seen = new Set<string>()
  return detailLabels.flatMap(([key, label]) => {
    const value = detail[key]
    // Codes ("enquiry", "event") and words already in the title add nothing.
    if (
      typeof value !== 'string' ||
      !/\s/.test(value.trim()) ||
      title.includes(value.trim()) ||
      seen.has(value)
    )
      return []
    seen.add(value)
    return [{ key, label, value: value.trim() }]
  })
}

function ActivityItem(props: { activity: iLeadActivity }) {
  const [open, setOpen] = useState(false)
  const title = readableTitle(props.activity.title)
  const lines = detailLines(props.activity.detail, title)
  return (
    <li className="timelineItem">
      <KindIcon kind={props.activity.kind} />
      <div className="timelineBody">
        <div className="timelineTop">
          <span>{title}</span>
          <time dateTime={props.activity.createdAt}>
            {formatWhen(props.activity.createdAt)}
          </time>
        </div>
        {lines.length > 0 && (
          <>
            <button
              type="button"
              className="timelineMore"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? 'Less' : 'Why?'}
              <ChevronDown size={12} />
            </button>
            {open && (
              <dl className="timelineDetail">
                {lines.map((line) => (
                  <div key={line.key}>
                    <dt>{line.label}</dt>
                    <dd>{line.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        )}
      </div>
    </li>
  )
}

// The lead as a colleague's notes: what happened, newest first, each with
// its reasoning a tap away.
export function LeadTimeline(props: {
  organizationId: string
  leadId: string
}) {
  const [activities, setActivities] = useState<iLeadActivity[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [error, setError] = useState('')
  const { organizationId, leadId } = props

  const load = useCallback(async () => {
    try {
      const page = await listLeadActivity(organizationId, leadId)
      setActivities(page.activities)
      setNextBefore(page.nextBefore ?? null)
    } catch (cause) {
      if (isUnavailable(cause)) setAvailable(false)
      else setError(problem(cause, 'Couldn’t load what happened here.'))
    }
  }, [organizationId, leadId])

  useEffect(() => {
    setActivities(null)
    setAvailable(true)
    setError('')
    void load()
  }, [load])

  async function earlier() {
    if (!nextBefore) return
    try {
      const page = await listLeadActivity(organizationId, leadId, nextBefore)
      const fresh = page.activities.filter(
        (item) => !activities?.some((known) => known.id === item.id),
      )
      setActivities((current) => [...(current ?? []), ...fresh])
      setNextBefore(page.nextBefore ?? null)
    } catch (cause) {
      setError(problem(cause, 'Couldn’t load earlier notes.'))
    }
  }

  if (!available) return null
  return (
    <section className="detailSection">
      <h4>What happened</h4>
      {error && <p className="inlineError">{error}</p>}
      {!activities ? (
        !error && (
          <div className="timelineLoading">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )
      ) : activities.length ? (
        <ol className="timeline">
          {activities.map((activity) => (
            <ActivityItem key={activity.id} activity={activity} />
          ))}
        </ol>
      ) : (
        <p className="mutedLine timelineEmpty">
          Nothing yet. I’ll note everything I do for this lead here.
        </p>
      )}
      {nextBefore && (
        <button
          type="button"
          className="loadMore"
          onClick={() => void earlier()}
        >
          Show earlier
        </button>
      )}
    </section>
  )
}

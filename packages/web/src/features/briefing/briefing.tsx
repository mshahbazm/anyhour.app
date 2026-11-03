import { Link } from '@tanstack/react-router'
import { ChevronRight, Hand, Lightbulb, MessagesSquare } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { saveTracking, visitorCountsLine } from '../insights/visitorCounts'
import { formatLeadValue } from '../leads/status'
import { problem } from '../workspace/api'
import { formatWhen } from '../workspace/formatWhen'
import type { iAssistant, iLead } from '../workspace/types'
import type { iMonthStats } from './api'
import './briefing.css'

// What the AI tells the owner when they open its chat: who's waiting,
// this month from visitor to won lead, and the newest leads. Every part
// leads to the list behind it; the chat carries on below.
export function Briefing(props: {
  organizationId: string | null
  bot: iAssistant | undefined
  canEdit: boolean
  stats: iMonthStats | null
  statsError: string
  needsYou: number
  newLeads: number
  latestNew: iLead[]
  onBotChanged: (bot: iAssistant) => void
}) {
  const { stats } = props
  if (props.statsError) return <p className="inlineError">{props.statsError}</p>
  if (!stats) return <Skeleton className="briefingSkeleton h-36 w-full" />
  // One card: who's waiting, the month's funnel, the newest leads, totals.
  return (
    <div className="briefing">
      {props.needsYou > 0 && (
        <Link
          className="briefingAlert"
          to="/conversations"
          search={{ filter: 'needsYou' }}
        >
          <Hand size={15} aria-hidden="true" />
          <strong>
            {props.needsYou}{' '}
            {props.needsYou === 1 ? 'conversation needs' : 'conversations need'}{' '}
            you
          </strong>
          <ChevronRight size={15} aria-hidden="true" />
        </Link>
      )}
      <Funnel
        stats={stats}
        organizationId={props.organizationId}
        bot={props.bot}
        canEdit={props.canEdit}
        onBotChanged={props.onBotChanged}
      />
      {props.latestNew.length > 0 && (
        <section className="briefingLeads" aria-label="New leads">
          <header>
            <span>New leads</span>
            <Link to="/leads" search={{ status: 'new' }}>
              {props.newLeads > props.latestNew.length
                ? `All ${props.newLeads}`
                : 'All leads'}
            </Link>
          </header>
          <ul>
            {props.latestNew.map((lead) => (
              <li key={lead.id}>
                <Link to="/leads/$leadId" params={{ leadId: lead.id }}>
                  <span className="briefingLeadName">
                    {lead.contactName || lead.contactEmail || 'Someone'}
                  </span>
                  <span className="briefingLeadTitle">{lead.title}</span>
                  <time>{formatWhen(lead.createdAt)}</time>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer className="briefingTotals">
        <Link
          to="/conversations"
          search={{ filter: 'all' }}
          title={
            stats.customersAnswered > 0
              ? `${stats.outsideHours.toLocaleString()} outside business hours`
              : undefined
          }
        >
          <MessagesSquare size={14} aria-hidden="true" />
          <strong>{stats.customersAnswered.toLocaleString()}</strong>
          {stats.customersAnswered === 1 ? 'customer' : 'customers'} answered
        </Link>
        <Link to="/conversations" search={{ filter: 'needsYou' }}>
          <Hand size={14} aria-hidden="true" />
          <strong>{stats.neededYou.toLocaleString()}</strong>
          needed you
        </Link>
        <Link to="/business" hash="notes">
          <Lightbulb size={14} aria-hidden="true" />
          <strong>{stats.answersLearned.toLocaleString()}</strong>
          {stats.answersLearned === 1 ? 'answer' : 'answers'} learned
        </Link>
      </footer>
    </div>
  )
}

// Of the step before, as a whole percentage; none when it can't be said
// (no step before, or more than all of it, as leads won this month can be
// from earlier months).
function rate(value: number, before: number | null) {
  if (!before || value > before) return null
  return Math.round((value / before) * 100)
}

function Funnel(props: {
  stats: iMonthStats
  organizationId: string | null
  bot: iAssistant | undefined
  canEdit: boolean
  onBotChanged: (bot: iAssistant) => void
}) {
  const { stats } = props
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function turnOn() {
    if (!props.organizationId || !props.bot) return
    setSaving(true)
    setError('')
    saveTracking(props.organizationId, props.bot.id, true)
      .then(props.onBotChanged)
      .catch((cause: unknown) => setError(problem(cause, 'Could not save')))
      .finally(() => setSaving(false))
  }
  const visitors = stats.websiteVisitors
  return (
    <section className="briefingFunnel" aria-label="From visitor to won lead">
      <ol>
        <li>
          {visitors === null && props.bot?.tracking ? (
            // Visitor counts are on, but not counting visits.
            <Link className="funnelStep" to="/" hash="website-insights">
              <span>Website visitors</span>
              <small>Visits aren’t counted</small>
            </Link>
          ) : visitors === null ? (
            <div className="funnelStep">
              <span>Website visitors</span>
              {props.canEdit && props.bot ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={turnOn}
                  title={visitorCountsLine}
                >
                  Turn on visitor counts
                </Button>
              ) : (
                <small>Visitor counts are off</small>
              )}
              {error && <small className="inlineError">{error}</small>}
            </div>
          ) : (
            <Link className="funnelStep" to="/" hash="website-insights">
              <Step value={visitors} label="Website visitors" />
            </Link>
          )}
        </li>
        <li>
          <Link
            className="funnelStep"
            to="/conversations"
            search={{ filter: 'all' }}
          >
            <Step
              value={stats.visitorsChatted}
              label="Started a chat"
              rate={rate(stats.visitorsChatted, visitors)}
            />
          </Link>
        </li>
        <li>
          <Link className="funnelStep" to="/leads" search={{ status: 'open' }}>
            <Step
              value={stats.leadsCaught}
              label="Leads caught"
              rate={rate(stats.leadsCaught, stats.visitorsChatted)}
            />
          </Link>
        </li>
        <li>
          <Link className="funnelStep" to="/leads" search={{ status: 'won' }}>
            <Step
              value={stats.leadsWon}
              label="Leads won"
              rate={rate(stats.leadsWon, stats.leadsCaught)}
              detail={
                stats.wonValue > 0 && `Worth ${formatLeadValue(stats.wonValue)}`
              }
            />
          </Link>
        </li>
      </ol>
    </section>
  )
}

function Step(props: {
  value: number
  label: string
  rate?: number | null
  detail?: ReactNode
}) {
  return (
    <>
      {props.rate != null && (
        <span className="funnelRate" title="Of the step before">
          {props.rate}%
        </span>
      )}
      <strong>{props.value.toLocaleString()}</strong>
      <span>{props.label}</span>
      {props.detail && <small>{props.detail}</small>}
    </>
  )
}

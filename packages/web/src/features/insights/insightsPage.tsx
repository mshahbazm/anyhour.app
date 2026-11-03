import {
  ArrowDownRight,
  ArrowUpRight,
  FileText,
  Globe2,
  Link2,
  Monitor,
  Rocket,
  Smartphone,
  Tablet,
} from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { Switch } from '#/components/ui/switch'
import { problem } from '../workspace/api'
import type { iAssistant } from '../workspace/types'
import { TrendChart } from './trendChart'
import { ranges, useInsights } from './useInsights'
import type {
  iInsightRow,
  iInsights,
  iInsightTotals,
  tRange,
} from './useInsights'
import {
  countedTracking,
  saveTracking,
  saveTrackingOptions,
  trackingRows,
} from './visitorCounts'
import type { tTracking } from './visitorCounts'
import './insights.css'

const regionNames = new Intl.DisplayNames(undefined, { type: 'region' })
function country(code: string) {
  const flag = String.fromCodePoint(
    ...[...code].map((letter) => 127397 + letter.charCodeAt(0)),
  )
  let name = code
  try {
    name = regionNames.of(code) ?? code
  } catch {
    /* An unknown code shows as itself. */
  }
  return { flag, name }
}

const number = new Intl.NumberFormat()

function change(now: number, before: number) {
  if (!before) return null
  return Math.round(((now - before) / before) * 100)
}

interface iInsightsPageProps {
  organizationId: string | null
  bot: iAssistant | undefined
  canEdit: boolean
  onInstall: (() => void) | null
  onChanged: (bot: iAssistant) => void
}

export function InsightsPage(props: iInsightsPageProps) {
  const [days, setDays] = useState<tRange>(30)
  const tracking = props.bot?.tracking ?? false
  const counted = countedTracking(props.bot)
  const { insights, error } = useInsights(
    props.organizationId,
    props.bot?.id,
    days,
    tracking,
  )
  const name = props.bot?.name ?? 'your AI'
  return (
    <div className="insightsPage">
      <div className="rangeSwitch" role="tablist" aria-label="Period">
        {ranges.map((range) => (
          <button
            key={range}
            type="button"
            role="tab"
            aria-selected={days === range}
            onClick={() => setDays(range)}
          >
            {range} days
          </button>
        ))}
      </div>
      {error && <p className="inlineError">{error}</p>}
      {!insights ? (
        <div className="insightsLoading">
          <Skeleton className="h-40" />
          <Skeleton className="h-56" />
        </div>
      ) : (
        <>
          {(!tracking || (counted.visits && !insights.hasVisits)) && (
            <Waiting
              name={name}
              tracking={tracking}
              onInstall={props.onInstall}
            />
          )}
          {(insights.hasVisits ||
            insights.totals.conversations + insights.totals.leads > 0) && (
            <Journey insights={insights} counted={counted} />
          )}
          {insights.hasVisits && counted.visits && (
            <section className="insightsCard">
              <TrendChart daily={insights.daily} />
            </section>
          )}
          {insights.hasVisits &&
            (counted.visits || counted.location || counted.device) && (
              <div className="breakdownGrid">
                {counted.visits && (
                  <Breakdown
                    title="Top pages"
                    icon={<FileText size={14} />}
                    rows={insights.top.page}
                    empty="No page views yet."
                    label={(value) => <code>{value}</code>}
                  />
                )}
                {counted.visits && (
                  <Breakdown
                    title="Where they came from"
                    icon={<Link2 size={14} />}
                    rows={insights.top.source}
                    empty="No visits yet."
                    label={(value) =>
                      value === 'direct' ? (
                        <span className="muted">Typed in or bookmarked</span>
                      ) : value === 'other' ? (
                        'Other sites'
                      ) : (
                        <>
                          <span className="sourceMark" aria-hidden="true">
                            {value.slice(0, 1).toUpperCase()}
                          </span>
                          {value}
                        </>
                      )
                    }
                  />
                )}
                {counted.location && (
                  <Breakdown
                    title="Countries"
                    icon={<Globe2 size={14} />}
                    rows={insights.top.country}
                    empty="No countries yet."
                    label={(value) => {
                      const place = country(value)
                      return (
                        <>
                          <span className="flag" aria-hidden="true">
                            {place.flag}
                          </span>
                          {place.name}
                        </>
                      )
                    }}
                  />
                )}
                {counted.device && <Devices insights={insights} />}
              </div>
            )}
        </>
      )}
      <TrackingSettings
        organizationId={props.organizationId}
        bot={props.bot}
        tracking={tracking}
        counted={counted}
        canEdit={props.canEdit}
        onChanged={props.onChanged}
      />
    </div>
  )
}

function Waiting(props: {
  name: string
  tracking: boolean
  onInstall: (() => void) | null
}) {
  const off = !props.tracking
  return (
    <section className="insightsWaiting">
      <h2>
        {off ? 'Visitor counts are off' : 'Waiting for your first visitor'}
      </h2>
      <p>
        {off
          ? 'Turn them on below to see who comes to your website.'
          : `Once ${props.name} is on your website, you’ll see how many people visit, from where, and how many start a chat. It updates every few seconds.`}
      </p>
      {props.onInstall && !off && (
        <Button size="sm" onClick={props.onInstall}>
          <Rocket size={14} /> Add to your website
        </Button>
      )}
    </section>
  )
}

const steps: Array<{
  key: keyof iInsightTotals
  label: string
  /** Counted only while visitor counts count this. */
  option?: keyof tTracking
}> = [
  { key: 'visitors', label: 'Visitors', option: 'visits' },
  { key: 'opens', label: 'Opened the chat', option: 'chat' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'leads', label: 'Leads' },
]

// The path from a visit to a lead, as one band that narrows step by step.
function Journey(props: { insights: iInsights; counted: tTracking }) {
  const { totals, previous, days } = props.insights
  const values = steps.map((step) =>
    step.option && !props.counted[step.option] ? null : totals[step.key],
  )
  const top = Math.max(1, ...values.map((value) => value ?? 0))
  // Square root keeps small steps visible next to big ones.
  const heights = values.map((value) =>
    Math.max(6, Math.sqrt((value ?? 0) / top) * 100),
  )
  const band = heights
    .map((height, index) => {
      const x = (index / (heights.length - 1)) * 100
      return `${x},${50 - height / 2}`
    })
    .concat(
      heights
        .map((height, index) => {
          const x = (index / (heights.length - 1)) * 100
          return `${x},${50 + height / 2}`
        })
        .reverse(),
    )
    .join(' ')
  return (
    <section className="insightsCard journey" aria-label="From visit to lead">
      <p className="journeySummary">{summary(totals, props.counted, days)}</p>
      <div className="journeySteps">
        <svg
          className="journeyBand"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon points={band} />
        </svg>
        {steps.map((step, index) => {
          const value = values[index]
          const before = values[index - 1]
          const rate =
            index > 0 && value !== null && before
              ? Math.round((value / before) * 100)
              : null
          const delta =
            value === null ? null : change(value, previous[step.key])
          return (
            <div key={step.key} className="journeyStep">
              {rate !== null && rate <= 100 && (
                <span
                  className="journeyRate"
                  title={`${rate}% of the step before`}
                >
                  {rate}%
                </span>
              )}
              <strong>{value === null ? '—' : number.format(value)}</strong>
              <span>{step.label}</span>
              {value === null ? (
                <small className="muted">Not counted</small>
              ) : delta !== null ? (
                <small className={delta >= 0 ? 'is-up' : 'is-down'}>
                  {delta >= 0 ? (
                    <ArrowUpRight size={12} />
                  ) : (
                    <ArrowDownRight size={12} />
                  )}
                  {Math.abs(delta)}% vs previous {days} days
                </small>
              ) : (
                <small className="muted">&nbsp;</small>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function summary(totals: iInsightTotals, counted: tTracking, days: number) {
  const parts = [
    counted.visits &&
      `${number.format(totals.visitors)} ${totals.visitors === 1 ? 'person' : 'people'} visited`,
    counted.chat && `${number.format(totals.opens)} opened the chat`,
    `${number.format(totals.leads)} became ${totals.leads === 1 ? 'a lead' : 'leads'}`,
  ].filter(Boolean)
  const last = parts.pop()
  return `In the last ${days} days, ${parts.length ? `${parts.join(', ')} and ${last}` : last}.`
}

function Breakdown(props: {
  title: string
  icon: ReactNode
  rows: iInsightRow[]
  empty: string
  label: (value: string) => ReactNode
}) {
  const top = Math.max(1, ...props.rows.map((row) => row.count))
  return (
    <section className="insightsCard breakdown">
      <h3>
        {props.icon}
        {props.title}
      </h3>
      {!props.rows.length ? (
        <p className="breakdownEmpty">{props.empty}</p>
      ) : (
        <ol>
          {props.rows.map((row) => (
            <li key={row.value}>
              <span
                className="breakdownBar"
                style={{ width: `${(row.count / top) * 100}%` }}
                aria-hidden="true"
              />
              <span className="breakdownLabel">{props.label(row.value)}</span>
              <span className="breakdownCount">{number.format(row.count)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

const deviceKinds = [
  { value: 'phone', label: 'Phone', icon: Smartphone },
  { value: 'tablet', label: 'Tablet', icon: Tablet },
  { value: 'computer', label: 'Computer', icon: Monitor },
]

function Devices(props: { insights: iInsights }) {
  const counts = deviceKinds.map(
    (kind) =>
      props.insights.top.device.find((row) => row.value === kind.value)
        ?.count ?? 0,
  )
  const total = counts.reduce((sum, value) => sum + value, 0)
  return (
    <section className="insightsCard breakdown">
      <h3>
        <Monitor size={14} />
        Devices
      </h3>
      {!total ? (
        <p className="breakdownEmpty">No visitors yet.</p>
      ) : (
        <>
          <div className="deviceSplit" aria-hidden="true">
            {deviceKinds.map((kind, index) =>
              counts[index] ? (
                <span
                  key={kind.value}
                  className={`is-${kind.value}`}
                  style={{ flexGrow: counts[index] }}
                />
              ) : null,
            )}
          </div>
          <ul className="deviceList">
            {deviceKinds.map((kind, index) => (
              <li key={kind.value}>
                <span className={`deviceDot is-${kind.value}`} />
                <kind.icon size={14} />
                {kind.label}
                <strong>{Math.round((counts[index] / total) * 100)}%</strong>
              </li>
            ))}
          </ul>
          {props.insights.top.browser.length > 0 && (
            <p className="browserLine">
              {props.insights.top.browser
                .slice(0, 4)
                .map(
                  (row) =>
                    `${row.value} ${Math.round((row.count / total) * 100)}%`,
                )
                .join(' · ')}
            </p>
          )}
        </>
      )}
    </section>
  )
}

// One switch for the whole business, off by default; while it's on, the
// owner chooses what is counted (all on by default).
function TrackingSettings(props: {
  organizationId: string | null
  bot: iAssistant | undefined
  tracking: boolean
  counted: tTracking
  canEdit: boolean
  onChanged: (bot: iAssistant) => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function save(
    request: (organizationId: string, botId: string) => Promise<iAssistant>,
  ) {
    if (!props.organizationId || !props.bot) return
    setSaving(true)
    setError('')
    request(props.organizationId, props.bot.id)
      .then(props.onChanged)
      .catch((cause: unknown) => setError(problem(cause, 'Could not save')))
      .finally(() => setSaving(false))
  }
  const disabled = !props.canEdit || saving
  return (
    <section className="trackingSettings" aria-label="Visitor counts">
      <label className="trackingSwitch">
        <div>
          <strong>Visitor counts</strong>
          {props.tracking && (
            <span>No cookies and nothing that identifies a person.</span>
          )}
        </div>
        <Switch
          checked={props.tracking}
          disabled={disabled}
          onCheckedChange={(tracking) =>
            save((organizationId, botId) =>
              saveTracking(organizationId, botId, tracking),
            )
          }
        />
      </label>
      {props.tracking && (
        <ul className="trackingOptions">
          {trackingRows.map((row) => (
            <li key={row.key}>
              <label className="trackingSwitch">
                <div>
                  <strong>{row.title}</strong>
                  <span>{row.detail}</span>
                </div>
                <Switch
                  size="sm"
                  checked={props.counted[row.key]}
                  disabled={disabled}
                  onCheckedChange={(on) =>
                    save((organizationId, botId) =>
                      saveTrackingOptions(organizationId, botId, {
                        ...props.counted,
                        [row.key]: on,
                      }),
                    )
                  }
                />
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="inlineError">{error}</p>}
    </section>
  )
}

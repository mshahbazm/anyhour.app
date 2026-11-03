import { ChevronRight, FileText, Globe } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../workspace/api'
import { PageToolbar } from '../workspace/pageTabs'
import { formatWhen } from '../workspace/formatWhen'
import { AddSource } from './addSource'
import type { tLinkKind } from './addSource'
import { SourceDetail } from './sourceDetail'
import { SourceIcon } from './sourceIcon'
import { displayUrl, sourceState, sourceTitle } from './sourceState'
import type { iKnowledgeState } from './useKnowledge'
import type {
  iIndexingRun,
  iKnowledgeGap,
  iWebsiteDecision,
  iKnowledgeSource,
} from '../workspace/types'
import { DecisionsSection } from './decisionsSection'
import { GapsSection } from './gapsSection'
import { NotesSection } from './notesSection'
import { OpeningHours } from './openingHours'
import type { tBusinessHours } from './openingHours'
import { TellBox } from './tellBox'
import { useKnowledgeNotes } from './useKnowledgeNotes'
import './knowledge.css'

interface iKnowledgePageProps {
  base: string | null
  organizationId: string | null
  /** The workspace's AI, for the website check before a fact is saved. */
  assistantId: string | null
  botName: string | null
  knowledge: iKnowledgeState
  canEdit: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  onUpload: (files: File[]) => Promise<void>
  /** Shown first: the business profile. */
  intro?: ReactNode
  disabled?: boolean
  gaps?: iKnowledgeGap[]
  onAnswerGap?: (gap: iKnowledgeGap) => void
  onDismissGap?: (gap: iKnowledgeGap) => void
  decisions?: iWebsiteDecision[]
  onResolveDecision?: (
    decision: iWebsiteDecision,
    choice: 'keep' | 'useWebsite',
  ) => Promise<void>
  /** Read from Your business; null until the profile loads. */
  openingHours?: {
    businessHours: tBusinessHours | null
    timeZone: string | null
  } | null
}

const phaseLabels: Record<string, string> = {
  queued: 'Waiting to start',
  crawling: 'Discovering pages',
  preparing: 'Reading and cleaning pages',
  embedding: 'Learning content',
  completed: 'Finishing up',
}

function plural(count: number, word: string) {
  return `${count} ${count === 1 ? word : `${word}s`}`
}

// Live progress while reading, or why the latest run learned nothing. Single
// pages that failed are shown on their website's row instead.
function RunProgress({ run, paused }: { run: iIndexingRun; paused: boolean }) {
  const active = run.status === 'queued' || run.status === 'running'
  const percent = run.discoveredCount
    ? Math.min(
        100,
        Math.round(
          ((run.indexedCount + run.failedCount) / run.discoveredCount) * 100,
        ),
      )
    : 0
  return (
    <div className={`runCard ${active ? '' : 'is-problem'}`} role="status">
      <div className="runCardTop">
        <strong>
          {active
            ? (phaseLabels[run.phase] ?? 'Reading')
            : 'Couldn’t read this source'}
        </strong>
        {run.discoveredCount > 0 && (
          <span>
            {run.indexedCount} of {plural(run.discoveredCount, 'page')}
          </span>
        )}
      </div>
      {active && (
        <div
          className={`progressTrack ${run.discoveredCount ? '' : 'is-indeterminate'}`}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      )}
      {run.failedCount > 0 && (
        <small>{plural(run.failedCount, 'page')} couldn’t be read</small>
      )}
      {run.errorSummary && <small>{run.errorSummary}</small>}
      {active && paused && (
        <small className="sourceProblem">
          Reading is paused because the background service isn’t running. It
          picks up where it left off once it’s back.
        </small>
      )}
    </div>
  )
}

const failed = (source: iKnowledgeSource) =>
  !source.archivedAt &&
  (source.status === 'failed' || source.status === 'unsupported')
// Archived pages left the site and set-aside ones are copies of another
// page; neither is learned, so they sink to the bottom and aren't counted.
const setAside = (source: iKnowledgeSource) =>
  Boolean(source.archivedAt) || source.status === 'excluded'
const rank = (source: iKnowledgeSource) =>
  failed(source) ? 0 : setAside(source) ? 2 : 1

// Your business: what the AI learns from, with its websites, files and
// notes.
export function KnowledgePage(props: iKnowledgePageProps) {
  const { knowledge } = props
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [tellPrefill, setTellPrefill] = useState<{
    text: string
    key: number
  } | null>(null)

  const { roots, children } = useMemo(() => {
    const ids = new Set(knowledge.sources.map((source) => source.id))
    const byParent = new Map<string, iKnowledgeSource[]>()
    const top: iKnowledgeSource[] = []
    for (const source of knowledge.sources) {
      if (source.kind === 'note') continue
      if (source.parentId && ids.has(source.parentId))
        byParent.set(source.parentId, [
          ...(byParent.get(source.parentId) ?? []),
          source,
        ])
      else top.push(source)
    }
    // Pages that need attention come first when a website is opened.
    for (const pages of byParent.values())
      pages.sort((a, b) => rank(a) - rank(b))
    return { roots: top, children: byParent }
  }, [knowledge.sources])

  const needle = query.trim().toLowerCase()
  const matches = (source: iKnowledgeSource) =>
    !needle ||
    `${sourceTitle(source)} ${source.inputUrl ?? ''}`
      .toLowerCase()
      .includes(needle)
  const noteSources = knowledge.sources.filter(
    (source) => source.kind === 'note',
  )
  const notes = useKnowledgeNotes(
    props.base,
    noteSources
      .map((note) => `${note.id}:${note.status}:${note.lastIndexedAt ?? ''}`)
      .join(','),
  )
  // Newest first, so a fact just told shows at the top.
  const recentNotes = [...notes].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )
  const botName = props.botName ?? 'your AI'
  const editable = props.canEdit && Boolean(props.base)
  const canTell =
    editable && Boolean(props.organizationId) && Boolean(props.assistantId)
  const latest = knowledge.runs[0]
  const runs = knowledge.runs
    .filter(
      (run) =>
        run.status === 'queued' ||
        run.status === 'running' ||
        (run === latest && run.status === 'failed' && !run.indexedCount),
    )
    .slice(0, 2)
  const learned = knowledge.sources.filter(
    (source) =>
      source.status === 'ready' &&
      source.isIncluded &&
      source.kind !== 'note' &&
      !children.has(source.id),
  ).length

  async function act(operation: () => Promise<unknown>) {
    setPending(true)
    setError('')
    try {
      await operation()
      await knowledge.refresh()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed')
      return false
    } finally {
      setPending(false)
    }
  }

  function addLink(kind: tLinkKind, url: string) {
    const base = props.base
    if (!base) return Promise.resolve(false)
    return act(() =>
      api(`${base}/sources`, {
        method: 'POST',
        body: JSON.stringify({ kind, url }),
      }),
    )
  }

  if (props.selectedId && props.base)
    return (
      <div className="page">
        <SourceDetail
          base={props.base}
          sourceId={props.selectedId}
          sources={knowledge.sources}
          canEdit={props.canEdit}
          onSelect={props.onSelect}
          variant="page"
          onChanged={knowledge.refresh}
        />
      </div>
    )

  const subtitle = (source: iKnowledgeSource, pages: iKnowledgeSource[]) => {
    if (pages.length) {
      const live = pages.filter((page) => !setAside(page)).length
      const broken = pages.filter(failed).length
      return (
        <>
          {plural(live, 'page')}
          {broken > 0 && (
            <span className="sourceProblem">
              {' · '}
              {broken} couldn’t be read
            </span>
          )}
        </>
      )
    }
    // Say why right in the list, so the owner needn't open each one.
    if (failed(source) && source.lastError)
      return <span className="sourceProblem">{source.lastError}</span>
    if (source.kind === 'upload')
      return source.createdAt
        ? `Uploaded ${formatWhen(source.createdAt)}`
        : 'Uploaded file'
    const address = displayUrl(source.inputUrl ?? source.canonicalUrl)
    return address === sourceTitle(source) ? null : address
  }

  const row = (source: iKnowledgeSource, nested = false) => {
    const state = sourceState(source)
    const pages = children.get(source.id) ?? []
    const open = expanded.includes(source.id) || Boolean(needle)
    const visiblePages = pages.filter(matches)
    if (!matches(source) && !visiblePages.length) return null
    const detail = subtitle(source, pages)
    return (
      <li key={source.id}>
        <div className={`sourceRow ${nested ? 'is-nested' : ''}`}>
          {pages.length > 0 ? (
            <button
              type="button"
              className="sourceExpand"
              aria-label={open ? 'Hide pages' : 'Show pages'}
              aria-expanded={open}
              onClick={() =>
                setExpanded((items) =>
                  items.includes(source.id)
                    ? items.filter((item) => item !== source.id)
                    : [...items, source.id],
                )
              }
            >
              <ChevronRight size={14} />
            </button>
          ) : (
            !nested && <span className="sourceExpand" />
          )}
          <button
            type="button"
            className="sourceRowMain"
            onClick={() => props.onSelect(source.id)}
          >
            <SourceIcon source={source} />
            <span className="sourceRowText">
              <strong>{sourceTitle(source)}</strong>
              {detail && <small>{detail}</small>}
            </span>
            <span className={`statusBadge tone-${state.tone}`}>
              {state.label}
            </span>
          </button>
        </div>
        {pages.length > 0 && open && (
          <ul className="sourceChildren">
            {visiblePages.map((page) => row(page, true))}
          </ul>
        )}
      </li>
    )
  }

  const hasFiles = (types: readonly string[]) => types.includes('Files')

  return (
    <>
      {knowledge.sources.length > 6 && (
        <PageToolbar
          search={{
            value: query,
            placeholder: 'Search sources',
            onChange: setQuery,
          }}
        />
      )}
      <section
        className="knowledgePage page"
        aria-label="Your business"
        onDragEnter={(event) => {
          if (editable && hasFiles(event.dataTransfer.types)) setDragging(true)
        }}
        onDragOver={(event) => {
          if (dragging) event.preventDefault()
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragging(false)
        }}
        onDrop={(event) => {
          if (!dragging) return
          event.preventDefault()
          setDragging(false)
          const files = Array.from(event.dataTransfer.files)
          if (files.length) void act(() => props.onUpload(files))
        }}
      >
        <DecisionsSection
          decisions={props.decisions ?? []}
          botName={botName}
          canEdit={props.canEdit}
          disabled={Boolean(props.disabled)}
          onResolve={async (decision, choice) =>
            props.onResolveDecision?.(decision, choice)
          }
        />
        {props.intro}
        {props.base && props.openingHours && (
          <OpeningHours
            hours={props.openingHours.businessHours}
            timeZone={props.openingHours.timeZone}
            botName={botName}
            onTell={
              canTell
                ? () =>
                    setTellPrefill((current) => ({
                      text: 'We’re open ',
                      key: (current?.key ?? 0) + 1,
                    }))
                : undefined
            }
          />
        )}
        <GapsSection
          gaps={props.gaps ?? []}
          botName={botName}
          canEdit={props.canEdit}
          disabled={Boolean(props.disabled)}
          onAnswer={(gap) => props.onAnswerGap?.(gap)}
          onDismiss={(gap) => props.onDismissGap?.(gap)}
        />

        {canTell && props.base && props.organizationId && props.assistantId && (
          <TellBox
            base={props.base}
            organizationId={props.organizationId}
            assistantId={props.assistantId}
            botName={botName}
            disabled={Boolean(props.disabled)}
            prefill={tellPrefill}
            onSaved={() => void knowledge.refresh().catch(() => undefined)}
          />
        )}
        <NotesSection
          title={`What you told ${botName}`}
          notes={recentNotes}
          empty="Nothing yet."
          canEdit={props.canEdit}
          disabled={Boolean(props.disabled)}
          onOpen={props.onSelect}
        />

        <section className="knowledgeSection" aria-labelledby="sourcesHeading">
          <div className="knowledgeSectionHead">
            <h2 id="sourcesHeading">Website and files</h2>
            <p>
              {knowledge.loaded && roots.length > 0
                ? `${learned} ${learned === 1 ? 'page or file' : 'pages and files'} read.`
                : `Your website, pages and files. ${botName} reads these.`}
            </p>
          </div>
          {editable && (
            <AddSource
              botName={botName}
              placeholder="Paste a link to your website, a page or a PDF"
              dropLabel="Drop to add to your business"
              disabled={pending || Boolean(props.disabled)}
              dragging={dragging}
              onAddLink={addLink}
              onUpload={(files) => void act(() => props.onUpload(files))}
              onError={setError}
            />
          )}
          {error && (
            <p className="inlineError" role="alert">
              {error}
            </p>
          )}
          {runs.map((run) => (
            <RunProgress key={run.id} run={run} paused={knowledge.paused} />
          ))}

          {!props.base ? (
            <div className="panelEmpty">
              <span className="panelEmptyIcon">
                <Globe size={20} />
              </span>
              <h3>Nothing here yet</h3>
              <p>Your AI isn’t set up yet.</p>
            </div>
          ) : !knowledge.loaded ? (
            <div className="skeletonList" aria-label="Loading sources">
              <span />
              <span />
              <span />
            </div>
          ) : !roots.length ? (
            <div className="panelEmpty">
              <span className="panelEmptyIcon">
                <FileText size={20} />
              </span>
              <h3>Nothing here yet</h3>
              <p>
                {props.canEdit
                  ? 'Add a link or a file above and reading starts right away.'
                  : 'An owner or admin can add these.'}
              </p>
            </div>
          ) : (
            <>
              <ul className="sourceList">
                {roots.map((source) => row(source))}
              </ul>
              {knowledge.hasMore && (
                <button
                  type="button"
                  className="panelButton is-block"
                  disabled={pending}
                  onClick={() => void act(knowledge.loadMore)}
                >
                  Load more
                </button>
              )}
            </>
          )}
        </section>
      </section>
    </>
  )
}

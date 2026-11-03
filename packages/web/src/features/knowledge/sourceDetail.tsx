import { ArrowLeft, ExternalLink, RefreshCw, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../workspace/api'
import { SkippedPaths } from './skippedPaths'
import { SourceIcon } from './sourceIcon'
import { displayUrl, kindLabels, sourceState, sourceTitle } from './sourceState'
import type { iKnowledgeSource } from '../workspace/types'

interface iSourceDetailProps {
  base: string
  sourceId: string
  sources: iKnowledgeSource[]
  canEdit: boolean
  onSelect: (id: string | null) => void
  onClose?: () => void
  variant?: 'panel' | 'page'
  onChanged: () => Promise<void>
}

export function SourceDetail(props: iSourceDetailProps) {
  const [detail, setDetail] = useState<iKnowledgeSource | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const listed = props.sources.find((source) => source.id === props.sourceId)
  const pages = props.sources.filter(
    (source) => source.parentId === props.sourceId,
  )
  const path = `${props.base}/sources/${encodeURIComponent(props.sourceId)}`

  useEffect(() => {
    let live = true
    setError('')
    setConfirming(false)
    void api<iKnowledgeSource>(path)
      .then((value) => {
        if (live) setDetail(value)
      })
      .catch((cause) => {
        if (live)
          setError(
            cause instanceof Error ? cause.message : 'Could not read source',
          )
      })
    return () => {
      live = false
    }
    // Re-read when the list refreshes so status and text stay current.
  }, [path, listed?.status, listed?.lastAttemptStatus, listed?.isIncluded])

  async function act(operation: () => Promise<unknown>) {
    setPending(true)
    setError('')
    try {
      await operation()
      await props.onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed')
    } finally {
      setPending(false)
    }
  }

  const source = detail ?? listed
  const state = source ? sourceState(source) : null
  return (
    <section
      className={`knowledgeSidebar ${props.variant === 'page' ? 'is-page' : ''}`}
      aria-label="Source inspector"
    >
      <header className="panelHeader is-compact">
        <button
          type="button"
          className="ghostButton"
          aria-label="Back"
          onClick={() =>
            props.onSelect(
              source?.parentId &&
                props.sources.some((item) => item.id === source.parentId)
                ? source.parentId
                : null,
            )
          }
        >
          <ArrowLeft size={15} />
          Back
        </button>
        {props.onClose && (
          <button
            type="button"
            className="iconButton"
            aria-label="Close"
            onClick={props.onClose}
          >
            <X size={16} />
          </button>
        )}
      </header>
      <div className="panelBody">
        {error && (
          <p className="inlineError" role="alert">
            {error}
          </p>
        )}
        {!source ? (
          !error && (
            <div className="skeletonList" aria-label="Loading source">
              <span />
              <span />
            </div>
          )
        ) : (
          <>
            <div className="detailHead">
              <SourceIcon source={source} />
              <div>
                <h3>{sourceTitle(source)}</h3>
                <p>
                  {kindLabels[source.kind] ?? source.kind}
                  {source.inputUrl && (
                    <>
                      {' · '}
                      <a
                        href={source.inputUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {displayUrl(source.inputUrl)}
                        <ExternalLink size={11} />
                      </a>
                    </>
                  )}
                </p>
              </div>
            </div>
            {state && (
              <div className="detailMeta">
                <span className={`statusBadge tone-${state.tone}`}>
                  {state.label}
                </span>
                {source.lastIndexedAt && (
                  <span>
                    Updated{' '}
                    {new Date(source.lastIndexedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}
            {source.archiveNotice && (
              <p className="inlineNotice">{source.archiveNotice}</p>
            )}
            {source.lastError && (
              <p className="inlineError">{source.lastError}</p>
            )}
            {props.canEdit && (
              <div className="detailActions">
                {/* A note is learned the moment it's saved; nothing to re-read. */}
                {source.kind !== 'note' && (
                  <button
                    type="button"
                    className="panelButton"
                    disabled={pending}
                    onClick={() =>
                      void act(() =>
                        api(`${path}/runs`, { method: 'POST', body: '{}' }),
                      )
                    }
                  >
                    <RefreshCw size={13} /> Refresh
                  </button>
                )}
                <button
                  type="button"
                  className="panelButton"
                  disabled={pending}
                  onClick={() =>
                    void act(() =>
                      api(path, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          isIncluded: !source.isIncluded,
                        }),
                      }),
                    )
                  }
                >
                  {source.isIncluded ? 'Exclude' : 'Include'}
                </button>
                <button
                  type="button"
                  className="panelButton is-danger"
                  disabled={pending}
                  onClick={() => setConfirming(true)}
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            )}
            {confirming && (
              <div
                className="confirmBox"
                role="alertdialog"
                aria-label="Delete source"
              >
                <p>
                  Delete <strong>{sourceTitle(source)}</strong>
                  {pages.length ? ` and its ${pages.length} pages` : ''}? The
                  bot will stop using this knowledge.
                </p>
                <div>
                  <button
                    type="button"
                    className="panelButton"
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="panelButton is-dangerSolid"
                    disabled={pending}
                    onClick={() =>
                      void act(async () => {
                        await api(path, { method: 'DELETE' })
                        props.onSelect(null)
                      })
                    }
                  >
                    Delete source
                  </button>
                </div>
              </div>
            )}
            {source.kind === 'website' && detail && (
              <SkippedPaths
                source={detail}
                canEdit={props.canEdit}
                disabled={pending}
                onRemove={(excludePaths) =>
                  void act(async () =>
                    setDetail(
                      await api<iKnowledgeSource>(path, {
                        method: 'PATCH',
                        body: JSON.stringify({ excludePaths }),
                      }),
                    ),
                  )
                }
              />
            )}
            {pages.length > 0 && (
              <div className="detailSection">
                <h4>Pages · {pages.length}</h4>
                <ul className="sourceList">
                  {pages.map((page) => {
                    const pageState = sourceState(page)
                    return (
                      <li key={page.id}>
                        <button
                          type="button"
                          className="sourceRowMain"
                          onClick={() => props.onSelect(page.id)}
                        >
                          <span className="sourceRowText">
                            <strong>{sourceTitle(page)}</strong>
                            <small>{displayUrl(page.inputUrl)}</small>
                          </span>
                          <span
                            className={`statusBadge tone-${pageState.tone}`}
                          >
                            {pageState.label}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {!pages.length && (
              <div className="detailSection">
                <h4>What the bot learned</h4>
                <pre className="indexedText">
                  {detail?.cleanedText || 'Nothing indexed yet.'}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

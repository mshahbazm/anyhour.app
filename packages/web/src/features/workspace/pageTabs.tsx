import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'

// The toolbar: a full-width row under the top bar that narrows what the
// page shows: a search on the left, status tabs with counts on the right.

export interface iStatusTab<T extends string> {
  id: T
  label: string
  count?: number
}

// A sticky, edge-to-edge row above the page content.
export function PageToolbar(props: {
  search?: {
    value: string
    placeholder: string
    onChange: (value: string) => void
  }
  /** Shown on the left when there is no search. */
  start?: ReactNode
  /** On phones, give the search its own row so the controls fit. */
  wraps?: boolean
  children?: ReactNode
}) {
  return (
    <div className={`pageToolbar ${props.wraps ? 'is-wrapping' : ''}`}>
      {props.search ? (
        <label className="toolbarSearch">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">{props.search.placeholder}</span>
          <input
            type="search"
            placeholder={props.search.placeholder}
            value={props.search.value}
            onChange={(event) => props.search?.onChange(event.target.value)}
          />
          {props.search.value && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => props.search?.onChange('')}
            >
              <X size={14} />
            </button>
          )}
        </label>
      ) : (
        <div className="toolbarStart">{props.start}</div>
      )}
      {props.children}
    </div>
  )
}

// Status tabs for the toolbar: small, underlined, with counts.
export function StatusTabs<T extends string>(props: {
  label: string
  tabs: Array<iStatusTab<T>>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="statusTabs" role="tablist" aria-label={props.label}>
      {props.tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-controls={`panel-${tab.id}`}
          aria-selected={props.value === tab.id}
          onClick={() => props.onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && <span>{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

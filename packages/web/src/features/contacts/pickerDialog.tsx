import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Skeleton } from '#/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { problem } from '../workspace/api'

export interface iPickerOption {
  id: string
  label: string
  detail?: string
}

interface iPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  placeholder: string
  /** Searches as the person types; the empty query lists the newest. */
  search: (query: string) => Promise<iPickerOption[]>
  onPick: (option: iPickerOption) => void
  empty: string
  busy?: boolean
  error?: string
}

// Pick one of many with a search: a contact to merge, or a person to add to
// a lead.
export function PickerDialog(props: iPickerDialogProps) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<iPickerOption[] | null>(null)
  const [error, setError] = useState('')
  const { open, search } = props

  useEffect(() => {
    if (!open) return
    let live = true
    const timer = window.setTimeout(
      () => {
        void search(query)
          .then((found) => {
            if (!live) return
            setOptions(found)
            setError('')
          })
          .catch((cause) => {
            if (live) setError(problem(cause, 'Couldn’t search. Try again.'))
          })
      },
      query ? 200 : 0,
    )
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [open, query, search])

  useEffect(() => {
    if (open) return
    setQuery('')
    setOptions(null)
    setError('')
  }, [open])

  const typed = query.trim()
  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent className="pickerDialog">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <label className="pickerSearch">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">{props.placeholder}</span>
          <input
            type="search"
            autoFocus
            placeholder={props.placeholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {(error || props.error) && (
          <p className="inlineError">{props.error || error}</p>
        )}
        <div className="pickerResults" role="listbox" aria-label="Results">
          {!options ? (
            <>
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
            </>
          ) : options.length ? (
            options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={false}
                className="pickerOption"
                disabled={props.busy}
                onClick={() => props.onPick(option)}
              >
                <span className="pickerIcon">
                  {option.label.slice(0, 1).toUpperCase()}
                </span>
                <span className="pickerText">
                  <strong>{option.label}</strong>
                  {option.detail && <small>{option.detail}</small>}
                </span>
              </button>
            ))
          ) : (
            <p className="pickerEmpty">
              {typed ? 'Nothing matches.' : props.empty}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { Link2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { uploadAccept, uploadTypesLabel, validateUpload } from './useKnowledge'

export type tLinkKind = 'website' | 'webPage' | 'publicDocument'

const documentPattern = /\.(pdf|docx?|txt|md|markdown|csv)(\?.*)?$/i

function normalise(value: string) {
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

// A bare domain means the whole site; a deeper link most likely means just
// that page. The owner can switch either way.
function guessScope(value: string): 'website' | 'webPage' {
  try {
    const path = new URL(normalise(value)).pathname
    return path === '/' || path === '' ? 'website' : 'webPage'
  } catch {
    return 'website'
  }
}

interface iAddSourceProps {
  botName: string
  placeholder?: string
  /** Shown while files are dragged over the page. */
  dropLabel?: string
  disabled: boolean
  /** Files are being dragged over the page. */
  dragging: boolean
  onAddLink: (kind: tLinkKind, url: string) => Promise<boolean>
  onUpload: (files: File[]) => void
  onError: (message: string) => void
}

// One place to add something to learn from: paste a link or add files.
export function AddSource(props: iAddSourceProps) {
  const [url, setUrl] = useState('')
  const [scope, setScope] = useState<'website' | 'webPage' | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const trimmed = url.trim()
  const isDocument = documentPattern.test(trimmed)
  const kind: tLinkKind = isDocument
    ? 'publicDocument'
    : (scope ?? guessScope(trimmed))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!trimmed || props.disabled) return
    if (await props.onAddLink(kind, normalise(trimmed))) {
      setUrl('')
      setScope(null)
    }
  }

  function pick(files: File[]) {
    const problem = files.map(validateUpload).find(Boolean)
    if (problem) props.onError(problem)
    else if (files.length) props.onUpload(files)
  }

  return (
    <div className={`addSource ${props.dragging ? 'is-dragging' : ''}`}>
      <form className="addSourceLink" onSubmit={(event) => void submit(event)}>
        <label className="addSourceField">
          <Link2 size={15} aria-hidden="true" />
          <span className="sr-only">Link to learn from</span>
          <input
            type="text"
            inputMode="url"
            placeholder={
              props.placeholder ??
              'Paste a link to your website, a page or a PDF'
            }
            value={url}
            disabled={props.disabled}
            onChange={(event) => {
              setUrl(event.target.value)
              setScope(null)
            }}
          />
        </label>
        <button
          type="submit"
          className="primaryButton"
          disabled={props.disabled || !trimmed}
        >
          Add
        </button>
      </form>
      {trimmed && !isDocument && (
        <div className="addSourceScope">
          <span>Learn from</span>
          <div className="segmented" role="radiogroup" aria-label="How much">
            {(
              [
                ['website', 'The whole site'],
                ['webPage', 'Just this page'],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                onClick={() => setScope(value)}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="addSourceFiles">
        <button
          type="button"
          className="panelButton"
          disabled={props.disabled}
          onClick={() => picker.current?.click()}
        >
          <Upload size={14} /> Upload files
        </button>
        <span>
          {props.dragging
            ? (props.dropLabel ?? `Drop to give ${props.botName}`)
            : `or drop them here. ${uploadTypesLabel}, up to 10 MB each.`}
        </span>
        <input
          ref={picker}
          type="file"
          hidden
          multiple
          accept={uploadAccept}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            pick(files)
          }}
        />
      </div>
    </div>
  )
}

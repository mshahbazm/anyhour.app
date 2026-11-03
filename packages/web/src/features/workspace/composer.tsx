import { ArrowUp, FileText, Paperclip, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { uploadAccept, uploadTypesLabel } from '../knowledge/useKnowledge'

interface iComposerProps {
  value: string
  onValue: (value: string) => void
  files: File[]
  onFiles: (files: File[]) => void
  onSend: () => void
  disabled: boolean
  canAttach: boolean
  placeholder: string
  pickerRef: RefObject<HTMLInputElement | null>
  /** Lets the page focus the box (⌘K or /). */
  inputRef?: RefObject<HTMLTextAreaElement | null>
}

/** "⌘K" on Apple devices, "Ctrl K" elsewhere. */
export const shortcutKey =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘K'
    : 'Ctrl K'

export function Composer(props: iComposerProps) {
  const ownInput = useRef<HTMLTextAreaElement>(null)
  const input = props.inputRef ?? ownInput
  const picker = props.pickerRef
  const ready =
    !props.disabled && (props.value.trim() !== '' || props.files.length > 0)

  useEffect(() => {
    const element = input.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`
  }, [props.value])

  // Focus lands after any draft a page handed over, ready to keep typing.
  useEffect(() => {
    const element = input.current
    if (props.disabled || !element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [props.disabled])

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) props.onSend()
      }}
    >
      {props.files.length > 0 && (
        <ul className="composerFiles" aria-label="Attached files">
          {props.files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <FileText size={14} />
              <span>{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  props.onFiles(props.files.filter((_, item) => item !== index))
                }
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={input}
        rows={1}
        aria-label="Message Anyhour helper"
        placeholder={props.placeholder}
        value={props.value}
        maxLength={8000}
        disabled={props.disabled}
        onChange={(event) => props.onValue(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault()
            if (ready) props.onSend()
          }
        }}
      />
      <div className="composerBar">
        <button
          type="button"
          className="composerIcon"
          aria-label="Attach documents"
          title={
            props.canAttach
              ? `Attach ${uploadTypesLabel} (10 MB each)`
              : 'Only owners and admins can add files'
          }
          disabled={props.disabled || !props.canAttach}
          onClick={() => picker.current?.click()}
        >
          <Paperclip size={16} />
        </button>
        <input
          ref={picker}
          type="file"
          hidden
          multiple
          accept={uploadAccept}
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (picked.length) props.onFiles([...props.files, ...picked])
          }}
        />
        <span className="composerHint">
          <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line
          · <kbd>{shortcutKey}</kbd> from any page
        </span>
        <button
          type="submit"
          className="composerSend"
          aria-label="Send helper message"
          disabled={!ready}
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </form>
  )
}

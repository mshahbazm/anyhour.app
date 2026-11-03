import { Check, ChevronRight } from 'lucide-react'
import { RuleDraftCard } from '../memberRules/ruleDraftCard'
import type { iRuleDraftHandlers } from '../memberRules/ruleDraftCard'
import type { iChatBlock, iChoicePayload } from './types'

interface iChatBlockProps {
  block: iChatBlock
  disabled: boolean
  onRespond: (block: iChatBlock, value: string) => void
  /** Saving rules drafted in the chat. */
  ruleDraft: iRuleDraftHandlers
}

export function ChatBlock(props: iChatBlockProps) {
  const { payload } = props.block
  if (payload.type === 'ruleDraft')
    return Array.isArray(payload.rules) && payload.rules.length ? (
      <RuleDraftCard
        {...props.ruleDraft}
        block={props.block}
        payload={payload}
        disabled={props.disabled}
      />
    ) : null
  // A card type this client doesn't know yet renders nothing, not a crash.
  if (!Array.isArray(payload.options) || !Array.isArray(payload.items))
    return null
  return <ChoiceBlock {...props} payload={payload} />
}

function ChoiceBlock({
  block,
  disabled,
  onRespond,
  payload,
}: iChatBlockProps & { payload: iChoicePayload }) {
  const pending = block.status === 'pending'
  const selected = payload.options.find(
    (option) => option.value === block.resolvedValue,
  )

  if (payload.type === 'summary')
    return (
      <section className="chatCard" aria-label={payload.title}>
        <header className="chatCardHeader">
          <strong>{payload.title}</strong>
          {payload.description && <p>{payload.description}</p>}
        </header>
        {payload.items.length > 0 && (
          <dl className="summaryList">
            {payload.items.map((item, index) => (
              <div key={index}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    )

  if (!pending)
    return (
      <div className="chatCardResolved" aria-label={payload.title}>
        <span className="resolvedTitle">{payload.title}</span>
        {selected ? (
          <span className="resolvedValue">
            <Check size={13} />
            {selected.label}
          </span>
        ) : (
          <span className="resolvedValue is-muted">Answered in chat</span>
        )}
      </div>
    )

  return (
    <section
      className={`chatCard ${payload.type === 'confirmation' ? 'is-confirmation' : ''}`}
      aria-label={payload.title}
    >
      <header className="chatCardHeader">
        <strong>{payload.title}</strong>
        {payload.description && <p>{payload.description}</p>}
      </header>
      {payload.items.length > 0 && (
        <dl className="summaryList">
          {payload.items.map((item, index) => (
            <div key={index}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="choiceList">
        {payload.options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="choiceOption"
            disabled={disabled}
            onClick={() => onRespond(block, option.value)}
          >
            <span className="choiceText">
              <span>{option.label}</span>
              {option.description && <small>{option.description}</small>}
            </span>
            <ChevronRight size={15} className="choiceArrow" />
          </button>
        ))}
      </div>
    </section>
  )
}

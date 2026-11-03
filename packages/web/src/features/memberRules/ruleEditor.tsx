import { Plus, X } from 'lucide-react'
import { ruleLimits } from './api'
import type { iMemberRuleDraft } from './api'

interface iRuleEditorProps {
  value: iMemberRuleDraft
  onChange: (value: iMemberRuleDraft) => void
  disabled?: boolean
  autoFocus?: boolean
}

/** A rule or steps can be saved once every line has words. */
export function editorReady(value: iMemberRuleDraft) {
  if (!value.text.trim()) return false
  if (value.kind === 'rule') return true
  const steps = (value.steps ?? []).filter((step) => step.trim())
  return Boolean(value.when?.trim()) && steps.length >= 2
}

// Edits one rule (a line) or one set of steps (a when and numbered steps),
// before saving a draft or in place.
export function RuleEditor(props: iRuleEditorProps) {
  const { value } = props
  const change = (patch: Partial<iMemberRuleDraft>) =>
    props.onChange({ ...value, ...patch })
  const steps = value.steps ?? []
  const setStep = (index: number, text: string) =>
    change({ steps: steps.map((step, i) => (i === index ? text : step)) })

  return (
    <div className="ruleEditor">
      {value.kind === 'rule' ? (
        <textarea
          className="textField"
          aria-label="Rule"
          rows={2}
          value={value.text}
          maxLength={ruleLimits.text}
          disabled={props.disabled}
          autoFocus={props.autoFocus}
          onChange={(event) => change({ text: event.target.value })}
        />
      ) : (
        <>
          <input
            className="textField ruleWhenField"
            aria-label="When"
            value={value.when ?? ''}
            maxLength={ruleLimits.when}
            placeholder="When someone wants to book a visit"
            disabled={props.disabled}
            autoFocus={props.autoFocus}
            onChange={(event) =>
              change({
                when: event.target.value,
                // Steps typed without a title take the when as theirs.
                text:
                  value.text || event.target.value.slice(0, ruleLimits.text),
              })
            }
          />
          <ol className="ruleStepFields">
            {steps.map((step, index) => (
              <li key={index}>
                <span className="ruleStepDot" aria-hidden="true">
                  {index + 1}
                </span>
                <input
                  className="textField"
                  aria-label={`Step ${index + 1}`}
                  value={step}
                  maxLength={ruleLimits.step}
                  disabled={props.disabled}
                  onChange={(event) => setStep(index, event.target.value)}
                />
                {steps.length > 2 && (
                  <button
                    type="button"
                    className="ruleIconButton"
                    aria-label={`Remove step ${index + 1}`}
                    disabled={props.disabled}
                    onClick={() =>
                      change({ steps: steps.filter((_, i) => i !== index) })
                    }
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ol>
          {steps.length < ruleLimits.steps && (
            <button
              type="button"
              className="ruleAddStep"
              disabled={props.disabled}
              onClick={() => change({ steps: [...steps, ''] })}
            >
              <Plus size={14} /> Add a step
            </button>
          )}
        </>
      )}
    </div>
  )
}

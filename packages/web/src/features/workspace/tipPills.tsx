import { Lightbulb } from 'lucide-react'
import type { iTrainingTip } from './trainingTips'

// One or two tap-to-teach suggestions; each starts a short teaching chat.
export function TipPills(props: {
  tips: iTrainingTip[]
  disabled: boolean
  label?: string
  onTip: (tip: iTrainingTip) => void
}) {
  if (!props.tips.length) return null
  return (
    <div
      className="tipPills"
      role="group"
      aria-label={props.label ?? 'Teaching tips'}
    >
      <Lightbulb size={14} className="tipIcon" aria-hidden="true" />
      {props.label && <span className="tipLabel">{props.label}</span>}
      {props.tips.map((tip) => (
        <button
          key={tip.id}
          type="button"
          disabled={props.disabled}
          title={tip.prompt}
          onClick={() => props.onTip(tip)}
        >
          {tip.label}
        </button>
      ))}
    </div>
  )
}

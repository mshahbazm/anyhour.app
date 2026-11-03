import { ruleTagLabels } from './api'
import type { iMemberRuleDraft } from './api'

// How rules read at a glance: a line with a quiet tag, and steps as a card
// titled by its "When …" with a numbered stepper. Shared by the Rules page
// and the chat card.

export function RuleTags(props: { rule: iMemberRuleDraft }) {
  const { rule } = props
  if (rule.kind !== 'rule' || !rule.tag) return null
  return (
    <span className="ruleTags">
      <span className="ruleTag">{ruleTagLabels[rule.tag]}</span>
    </span>
  )
}

export function RuleLine(props: { rule: iMemberRuleDraft }) {
  return (
    <div className="ruleLine">
      <span className="ruleText">{props.rule.text}</span>
      <RuleTags rule={props.rule} />
    </div>
  )
}

export function StepsCard(props: {
  rule: iMemberRuleDraft
  /** Names who follows the steps: "Ava will:". */
  botName?: string
  /** The card's menu, top right. */
  actions?: React.ReactNode
}) {
  const { rule } = props
  return (
    <div className="stepsCard">
      <header>
        <h3>{rule.when ?? rule.text}</h3>
        <RuleTags rule={rule} />
        {props.actions}
      </header>
      {props.botName && <span className="stepsWho">{props.botName} will:</span>}
      <ol className="stepper">
        {(rule.steps ?? []).map((step, index) => (
          <li key={index}>
            <span className="ruleStepDot" aria-hidden="true">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

import type { iMemberRule } from '../../types/memberRule.types'

// How the AI's rules read in its prompts (visitor chat, replies it
// drafts). Every line is the owner's text, so each one is quoted as data.
// Tone rules shape the voice instead of being one rule among many.

export type tPromptRule = Pick<
  iMemberRule,
  'kind' | 'tag' | 'text' | 'when' | 'steps'
>

const quote = (text: string) => JSON.stringify(text)

/** The tone rules as quoted bullets; '' when none. */
export function toneLines(rules: tPromptRule[]) {
  return rules
    .filter((rule) => rule.kind === 'rule' && rule.tag === 'tone')
    .map((rule) => `- ${quote(rule.text)}`)
    .join('\n')
}

/** One-line rules (not tone), one quoted bullet each; '' when none. */
export function ruleLines(rules: tPromptRule[]) {
  return rules
    .filter((rule) => rule.kind === 'rule' && rule.tag !== 'tone')
    .map((rule) => `- ${quote(rule.text)}`)
    .join('\n')
}

/** Each set of steps as its "When …" line and numbered steps; '' when none. */
export function stepsText(rules: tPromptRule[]) {
  return rules
    .filter((rule) => rule.kind === 'steps' && rule.steps?.length)
    .map(
      (rule) =>
        `${quote(rule.when ?? rule.text)}:\n${(rule.steps ?? [])
          .map((step, index) => `${index + 1}. ${quote(step)}`)
          .join('\n')}`,
    )
    .join('\n\n')
}

/**
 * The owner's guidance for a conversation: their rules, the steps to follow
 * and what they said about the goal; '' when there's none.
 */
export function ownerGuidanceText(
  rules: tPromptRule[],
  goalNotes: string | null,
) {
  const lines = ruleLines(rules)
  const steps = stepsText(rules)
  const notes = goalNotes?.trim()
  return [
    lines && `Your rules (one per line, quoted):\n${lines}`,
    steps &&
      `Steps to follow: when one of these comes up, follow its steps in order. Skip a step the person already answered, and don't read the steps out (quoted):\n${steps}`,
    notes && `About the goal: ${quote(notes)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

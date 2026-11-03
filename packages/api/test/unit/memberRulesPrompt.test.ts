import { expect, test } from 'bun:test'
import {
  ownerGuidanceText,
  ruleLines,
  stepsText,
  toneLines,
} from '../../src/services/memberRules/prompt'
import type { tPromptRule } from '../../src/services/memberRules/prompt'

const rule = (text: string, extra: Partial<tPromptRule> = {}): tPromptRule => ({
  kind: 'rule',
  tag: null,
  text,
  when: null,
  steps: null,
  ...extra,
})
const steps: tPromptRule = {
  kind: 'steps',
  tag: null,
  text: 'Booking a visit',
  when: 'When someone wants to book a visit',
  steps: ['Ask which day suits them', 'Ask for the "address"'],
}

test('one quoted line per rule, in order, tone kept apart', () => {
  const rules = [
    rule('Never mention discounts', { tag: 'never' }),
    rule('Warm and short', { tag: 'tone' }),
    rule('Reply in English'),
  ]
  expect(ruleLines(rules)).toBe(
    '- "Never mention discounts"\n- "Reply in English"',
  )
  expect(toneLines(rules)).toBe('- "Warm and short"')
})

test('steps read as a numbered list under their when, quoted', () => {
  expect(stepsText([steps])).toBe(
    '"When someone wants to book a visit":\n1. "Ask which day suits them"\n2. "Ask for the \\"address\\""',
  )
})

test('guidance joins rules, steps and goal notes; empty when there are none', () => {
  expect(ownerGuidanceText([], null)).toBe('')
  expect(ownerGuidanceText([rule('Be warm', { tag: 'tone' })], '  ')).toBe('')
  const text = ownerGuidanceText(
    [rule('Never mention discounts'), steps],
    'Get bookings',
  )
  expect(text).toContain(
    'Your rules (one per line, quoted):\n- "Never mention discounts"',
  )
  expect(text).toContain(
    'Steps to follow: when one of these comes up, follow its steps in order.',
  )
  expect(text).toContain('About the goal: "Get bookings"')
  expect(text.indexOf('Your rules')).toBeLessThan(
    text.indexOf('Steps to follow'),
  )
})

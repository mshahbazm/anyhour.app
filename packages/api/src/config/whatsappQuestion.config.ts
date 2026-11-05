import type { tMemberRuleTag } from './memberRules.config'

// The WhatsApp question (docs/whatsappQuestion.md): a starter question that
// asks the AI to move to WhatsApp. A rule decides how the AI does that, and
// it shares the number as the WhatsApp button, never as typed text.

export const whatsappApproaches = [
  'straightAway',
  'quickQuestion',
  'qualifyFirst',
] as const
export type tWhatsappApproach = (typeof whatsappApproaches)[number]

/** Stored in `assistant.appearance.whatsapp`. */
export interface iWhatsappQuestion {
  /** The starter question, 1..80 characters. */
  question: string
  /** Digits only, with the country code (8..15 digits). */
  number: string
  approach: tWhatsappApproach
  /** The member_rule this created. */
  ruleId: string | null
}

export const whatsappQuestionLimits = {
  questionLength: 80,
  minDigits: 8,
  maxDigits: 15,
} as const

export const defaultWhatsappQuestion = 'Chat with us on WhatsApp'

// The rule each approach saves. Changing approach rewrites that rule's text
// and tag; a rule whose text no longer matches is the owner's own ("custom").
export const whatsappRules: Record<
  tWhatsappApproach,
  { tag: tMemberRuleTag; text: string }
> = {
  straightAway: {
    tag: 'always',
    text: 'When someone asks to talk on WhatsApp, send the WhatsApp button straight away.',
  },
  quickQuestion: {
    tag: 'askFirst',
    text: 'When someone asks to talk on WhatsApp, first ask their name and what they need in one short message, then send the WhatsApp button.',
  },
  qualifyFirst: {
    tag: 'askFirst',
    text: "When someone asks to talk on WhatsApp, ask your lead questions first, and send the WhatsApp button only once they're a good fit.",
  },
}

/** The WhatsApp button's label and the message it starts with. */
export const whatsappButton = {
  label: 'Chat on WhatsApp',
  prefill: 'Hi, I found you on your website.',
} as const

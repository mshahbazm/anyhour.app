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

/**
 * Stored in `assistant.appearance.whatsapp`. The number is a fact in Your
 * business (contact details), never stored here.
 */
export interface iWhatsappQuestion {
  /** The starter question, 1..80 characters. */
  question: string
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
export const defaultWhatsappApproach: tWhatsappApproach = 'quickQuestion'

/** The note a typed number is saved as (docs/whatsappQuestion.md, Revision 2). */
export const whatsappNote = {
  title: 'WhatsApp',
  text: (digits: string) =>
    `Our WhatsApp number is +${digits} (https://wa.me/${digits}).`,
} as const

/** Why the WhatsApp button can't be shown, as the visitor chat's AI reads it. */
export const whatsappButtonMissing = {
  number:
    'No WhatsApp number is saved. Tell them the team will get back to them and offer to take their contact details.',
  question: 'The business doesn’t share WhatsApp in this chat.',
  onWhatsapp: 'They’re already on WhatsApp.',
} as const

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

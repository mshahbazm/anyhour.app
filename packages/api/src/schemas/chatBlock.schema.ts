import { z } from 'zod'

// Chat UI blocks the AI can show visitors under a reply
// (docs/channels.md, wave 4). The model fills them through the send_blocks
// tool (`blockInputSchema`); the server resolves them into stored blocks
// (`chatBlockSchema`) with an id and a plain-text fallback it writes itself.
// Limits follow WhatsApp's interactive messages: 3 reply buttons of 20
// characters, 10 list rows of 24 with 72-character descriptions.

export const blockLimits = {
  choices: 3,
  choiceChars: 20,
  listOptions: 10,
  listChars: 24,
  descriptionChars: 72,
  buttonLabelChars: 20,
  checklistItems: 12,
  checklistChars: 120,
  titleChars: 60,
} as const

const label = (max: number) => z.string().trim().min(1).max(max)

// What the model may send. Strict and small: names, labels and items only.
export const blockInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('choices'),
    options: z
      .array(z.object({ label: label(blockLimits.choiceChars) }))
      .min(2)
      .max(blockLimits.choices)
      .describe('Up to 3 quick replies, each 20 characters at most.'),
  }),
  z.object({
    kind: z.literal('list'),
    buttonLabel: label(blockLimits.buttonLabelChars)
      .nullish()
      .describe('What the button that opens the list says, e.g. "See times".'),
    options: z
      .array(
        z.object({
          label: label(blockLimits.listChars),
          description: z
            .string()
            .trim()
            .max(blockLimits.descriptionChars)
            .nullish(),
        }),
      )
      .min(2)
      .max(blockLimits.listOptions)
      .describe('Up to 10 options, each 24 characters at most.'),
  }),
  z.object({
    kind: z.literal('checklist'),
    title: label(blockLimits.titleChars).describe('e.g. "What to bring"'),
    items: z
      .array(
        z.object({
          text: label(blockLimits.checklistChars),
          done: z.boolean(),
        }),
      )
      .min(1)
      .max(blockLimits.checklistItems),
  }),
  z.object({
    kind: z.literal('contactForm'),
    ask: z.enum(['email', 'phone', 'emailOrPhone']),
    askName: z.boolean().describe('Also ask for their name.'),
    topic: label(120).describe(
      'What they want, as a short title for the team, e.g. "Whitening quote".',
    ),
  }),
  // The WhatsApp button (docs/whatsappQuestion.md): the server fills in the
  // business's number, so the model never writes it.
  z.object({ kind: z.literal('whatsapp') }),
])
export type tBlockInput = z.infer<typeof blockInputSchema>

const id = z.string().min(1).max(64)
const fallback = z.string().max(4_000)
const option = z.object({
  label: z.string().min(1).max(blockLimits.listChars),
  value: z.string().min(1).max(100),
  description: z.string().max(blockLimits.descriptionChars).optional(),
})

// What a message stores (`message.blocks`).
export const chatBlockSchema = z.discriminatedUnion('kind', [
  z.object({
    id,
    kind: z.literal('choices'),
    options: z.array(option).min(1).max(blockLimits.choices),
    fallback,
  }),
  z.object({
    id,
    kind: z.literal('list'),
    buttonLabel: z.string().min(1).max(blockLimits.buttonLabelChars),
    options: z.array(option).min(1).max(blockLimits.listOptions),
    fallback,
  }),
  z.object({
    id,
    kind: z.literal('checklist'),
    title: z.string().min(1).max(blockLimits.titleChars),
    items: z
      .array(
        z.object({
          text: z.string().min(1).max(blockLimits.checklistChars),
          done: z.boolean(),
        }),
      )
      .min(1)
      .max(blockLimits.checklistItems),
    fallback,
  }),
  z.object({
    id,
    kind: z.literal('contactForm'),
    ask: z.enum(['email', 'phone', 'emailOrPhone']),
    askName: z.boolean(),
    topic: z.string().min(1).max(120),
    fallback,
  }),
  z.object({
    id,
    kind: z.literal('whatsapp'),
    label: z.string().min(1).max(40),
    url: z.url().max(400),
    fallback,
  }),
])
export type tChatBlock = z.infer<typeof chatBlockSchema>
export const chatBlocksSchema = z.array(chatBlockSchema).max(1)

// A visitor's tap or form, sent back on their message.
export const blockReplySchema = z.object({
  blockId: id,
  value: z.string().min(1).max(100),
})
export type tBlockReply = z.infer<typeof blockReplySchema>

// What the contact form sends. Checked against the block's `ask`.
export const blockContactSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.email().max(254).optional(),
  phone: z.string().trim().min(6).max(32).optional(),
})
export type tBlockContact = z.infer<typeof blockContactSchema>

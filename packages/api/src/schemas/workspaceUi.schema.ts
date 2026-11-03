import { z } from 'zod'
import {
  memberRuleKinds,
  memberRuleLimits,
  memberRuleTags,
} from '../config/memberRules.config'

const option = z.object({
  value: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  description: z.string().max(300).nullable(),
})
// Choices, summaries and confirmations the helper (model) may author.
export const workspaceUiSchema = z
  .object({
    type: z.enum(['choice', 'actions', 'summary', 'confirmation']),
    title: z.string().min(1).max(200),
    description: z.string().max(1000).nullable(),
    options: z.array(option).max(12),
    items: z
      .array(
        z.object({ label: z.string().max(200), value: z.string().max(1000) }),
      )
      .max(50),
  })
  .superRefine((block, ctx) => {
    if (block.type !== 'summary' && !block.options.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Interactive blocks need options',
      })
    if (
      new Set(block.options.map((item) => item.value)).size !==
      block.options.length
    )
      ctx.addIssue({ code: 'custom', message: 'Option values must be unique' })
  })
export type tWorkspaceChoice = z.infer<typeof workspaceUiSchema>

// Cards only the server creates, from tool results. The model never writes
// these payloads.
// Rules drafted from the owner's words (docs/yourAi.md, "Rules"), saved
// when the owner taps Save.
const ruleDraftCard = z.object({
  type: z.literal('ruleDraft'),
  rules: z
    .array(
      z.object({
        kind: z.enum(memberRuleKinds),
        tag: z.enum(memberRuleTags).nullable(),
        text: z.string().min(1).max(memberRuleLimits.textLength),
        when: z.string().max(memberRuleLimits.whenLength).nullable(),
        steps: z
          .array(z.string().max(memberRuleLimits.stepLength))
          .max(memberRuleLimits.maxSteps)
          .nullable(),
      }),
    )
    .min(1)
    .max(memberRuleLimits.perSave),
  status: z.enum(['proposed', 'saved', 'dismissed']),
})
export const workspaceCardSchema = z.discriminatedUnion('type', [ruleDraftCard])
export type tWorkspaceCard = z.infer<typeof workspaceCardSchema>

// Every stored block payload.
export const workspaceBlockSchema = z.union([
  workspaceUiSchema,
  workspaceCardSchema,
])
export type tWorkspaceUi = tWorkspaceChoice | tWorkspaceCard

export function isChoiceBlock(
  payload: tWorkspaceUi,
): payload is tWorkspaceChoice {
  return 'options' in payload
}

// A tap on the drafted rules card: Save or Not now.
export const ruleDraftActionSchema = z.object({
  action: z.enum(['save', 'dismiss']),
})
export type tRuleDraftAction = z.infer<typeof ruleDraftActionSchema>
export type tRuleDraftCard = z.infer<typeof ruleDraftCard>

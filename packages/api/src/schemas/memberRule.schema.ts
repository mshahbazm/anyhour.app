import { z } from 'zod'
import { memberRuleLimits, memberRuleTags } from '../config/memberRules.config'

const text = z.string().trim().min(1).max(memberRuleLimits.textLength)
const when = z.string().trim().min(1).max(memberRuleLimits.whenLength)
const steps = z
  .array(z.string().trim().min(1).max(memberRuleLimits.stepLength))
  .min(memberRuleLimits.minSteps)
  .max(memberRuleLimits.maxSteps)
const tag = z.enum(memberRuleTags).nullable()

// One rule or one set of steps, as saved from the Rules page or a chat card.
export const memberRuleInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rule'),
    text,
    tag: tag.optional(),
  }),
  z.object({
    kind: z.literal('steps'),
    text,
    when,
    steps,
    tag: tag.optional(),
  }),
])
export type tMemberRuleInput = z.infer<typeof memberRuleInputSchema>

export const createMemberRulesSchema = z.object({
  rules: z.array(memberRuleInputSchema).min(1).max(memberRuleLimits.perSave),
})

// when and steps only apply to steps.
export const updateMemberRuleSchema = z
  .object({
    text: text.optional(),
    when: when.optional(),
    steps: steps.optional(),
    tag: tag.optional(),
  })
  .refine((value) => Object.keys(value).length > 0)
export type tUpdateMemberRuleInput = z.infer<typeof updateMemberRuleSchema>

// Every rule, in the new order.
export const orderMemberRulesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
})

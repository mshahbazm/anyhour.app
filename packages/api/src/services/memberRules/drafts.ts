import { z } from 'zod'
import {
  memberRuleLimits,
  memberRuleTags,
  ruleOrFact,
} from '../../config/memberRules.config'
import type {
  iMemberRuleDraft,
  iMemberRuleDrafts,
} from '../../types/memberRule.types'
import { draftFromText } from '../ai/draftFromText'
import { listMemberRules } from './rules'

const draftSchema = z.object({
  kind: z.enum(['rule', 'steps']),
  tag: z.enum(memberRuleTags).nullable(),
  text: z.string().nullable(),
  when: z.string().nullable(),
  steps: z.array(z.string()),
})

export const ruleDraftInstructions = `Each record is one rule for how the AI behaves in a conversation with a customer, or one short procedure (steps) for one situation. The text may hold one or several; return one record each.
- kind "rule": one instruction that stands alone ("Never mention discounts", "Always ask for their postcode before giving a price"). text is that instruction as one short, clear sentence in the owner's words, written as an instruction to the AI. when is null and steps is empty.
- kind "steps": only when the owner gives an order for a situation ("when someone wants to book a visit, first ask…, then…"). when is the situation as one line starting with "When" ("When someone wants to book a visit"). steps are 2 to ${memberRuleLimits.maxSteps} short instructions in the owner's order, one action each. text is a two-to-five-word title for it ("Booking a visit").
- tag: "never" for things never to say or do, "tone" for how it sounds, "askFirst" for what to find out before anything else, "handOver" for when a person on the team takes over, "always" for other things it always does; null when none fits. Always null for steps.
- Return no record for facts. For a message that holds both, return only the behaviour, referring to the detail without repeating it.
${ruleOrFact}
- context.existingRules lists the rules already saved; don't return a record that only repeats one.
Report nothing in "missing" unless a steps record has fewer than two steps.`

const clip = (value: string, limit: number) => value.trim().slice(0, limit)

// Model output to a draft that can be saved as it is, or null when it can't.
function toDraft(record: z.infer<typeof draftSchema>): iMemberRuleDraft | null {
  const steps = record.steps
    .map((step) => clip(step, memberRuleLimits.stepLength))
    .filter(Boolean)
    .slice(0, memberRuleLimits.maxSteps)
  const text = record.text ? clip(record.text, memberRuleLimits.textLength) : ''
  const when = record.when ? clip(record.when, memberRuleLimits.whenLength) : ''
  if (record.kind === 'steps' && steps.length >= memberRuleLimits.minSteps)
    return {
      kind: 'steps',
      tag: null,
      text: text || when.slice(0, memberRuleLimits.textLength),
      when: when || `When ${text}`.slice(0, memberRuleLimits.whenLength),
      steps,
    }
  // Steps with one step read as one rule.
  const single =
    text ||
    [when, steps[0]]
      .filter(Boolean)
      .join(': ')
      .slice(0, memberRuleLimits.textLength)
  if (!single) return null
  return {
    kind: 'rule',
    tag: record.kind === 'rule' ? record.tag : null,
    text: single,
    when: null,
    steps: null,
  }
}

/**
 * Drafts the AI's rules from the owner's words, for them to check before
 * saving: one-line rules with an inferred tag, or steps for a situation.
 * Saves nothing.
 */
export async function draftRuleFromText(
  organizationId: string,
  text: string,
): Promise<iMemberRuleDrafts> {
  const existing = await listMemberRules(organizationId)
  const { records, missing } = await draftFromText({
    task: 'ruleDrafts',
    instructions: ruleDraftInstructions,
    schema: draftSchema,
    context: {
      existingRules: existing.map((rule) =>
        rule.kind === 'steps'
          ? { when: rule.when, steps: rule.steps }
          : { rule: rule.text },
      ),
    },
    text,
    maxRecords: memberRuleLimits.perSave,
    usage: { organizationId },
  })
  const drafts: iMemberRuleDraft[] = []
  const hints = []
  for (const [index, record] of records.entries()) {
    const draft = toDraft(record)
    if (!draft) continue
    drafts.push(draft)
    // Hints follow their draft's new index.
    for (const item of missing)
      if (item.index === index && item.field !== 'text')
        hints.push({ ...item, index: drafts.length - 1 })
  }
  return { drafts, missing: hints }
}

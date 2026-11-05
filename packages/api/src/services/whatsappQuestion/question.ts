import { eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { assistant } from '../../db/schema'
import { defaultAppearance } from '../../config/appearance.config'
import type { iAppearance } from '../../config/appearance.config'
import {
  whatsappApproaches,
  whatsappRules,
} from '../../config/whatsappQuestion.config'
import type {
  iWhatsappQuestion,
  tWhatsappApproach,
} from '../../config/whatsappQuestion.config'
import type { tSaveWhatsappQuestion } from '../../schemas/whatsappQuestion.schema'
import type { iMemberRule } from '../../types/memberRule.types'
import type {
  iOwnerWhatsappQuestion,
  iPublicWhatsappQuestion,
} from '../../types/whatsappQuestion.types'
import { ownedAssistant } from '../auth/owned'
import { ApiError } from '../http/apiError'
import {
  createMemberRules,
  deleteMemberRule,
  listMemberRules,
  updateMemberRule,
} from '../memberRules/rules'
import { forgetSiteSettings } from '../widget/site'
import { parseWhatsappNumber } from './number'

// The WhatsApp question (docs/whatsappQuestion.md): saved in
// `assistant.appearance.whatsapp`, with the rule it made in `member_rule`.

type tAssistantRow = typeof assistant.$inferSelect

// The preset a rule still matches, or null when it's the owner's own.
function presetOf(rule: iMemberRule | undefined): tWhatsappApproach | null {
  if (!rule || rule.kind !== 'rule') return null
  return (
    whatsappApproaches.find(
      (approach) => whatsappRules[approach].text === rule.text,
    ) ?? null
  )
}

export function ownerWhatsapp(
  stored: iWhatsappQuestion,
  rules: iMemberRule[],
): iOwnerWhatsappQuestion {
  const rule = rules.find((item) => item.id === stored.ruleId)
  return { ...stored, approach: presetOf(rule) ?? 'custom' }
}

/** The AI as owners read it: its WhatsApp question says which rule it follows. */
export async function ownerAssistant(row: tAssistantRow) {
  const stored = row.appearance.whatsapp
  if (!stored) return row
  const rules = await listMemberRules(row.organizationId)
  return {
    ...row,
    appearance: { ...row.appearance, whatsapp: ownerWhatsapp(stored, rules) },
  }
}

/** The widget's appearance: the WhatsApp question without its number. */
export function publicAppearance(appearance: iAppearance) {
  const whatsapp: iPublicWhatsappQuestion | null = appearance.whatsapp
    ? { question: appearance.whatsapp.question }
    : null
  return { ...defaultAppearance, ...appearance, whatsapp }
}

/**
 * The generic appearance save, keeping the stored WhatsApp question: only
 * its own routes set or remove it.
 */
export function appearanceKeepingWhatsapp(
  appearance: Omit<iAppearance, 'whatsapp'>,
) {
  return sql`${JSON.stringify(appearance)}::jsonb || case when ${assistant.appearance} ? 'whatsapp' then jsonb_build_object('whatsapp', ${assistant.appearance} -> 'whatsapp') else '{}'::jsonb end`
}

async function writeWhatsapp(
  assistantId: string,
  value: iWhatsappQuestion | null,
) {
  await db
    .update(assistant)
    .set({
      appearance: value
        ? sql`jsonb_set(${assistant.appearance}, '{whatsapp}', ${JSON.stringify(value)}::jsonb)`
        : sql`${assistant.appearance} - 'whatsapp'`,
    })
    .where(eq(assistant.id, assistantId))
  forgetSiteSettings(assistantId)
}

export async function saveWhatsappQuestion(
  organizationId: string,
  assistantId: string,
  input: tSaveWhatsappQuestion,
): Promise<iOwnerWhatsappQuestion> {
  const ai = await ownedAssistant(organizationId, assistantId)
  const number = parseWhatsappNumber(input.number)
  if (!number)
    throw new ApiError(
      400,
      'invalid_whatsapp_number',
      'Use a WhatsApp number with its country code, like +44 7700 900123',
    )
  const current = ai.appearance.whatsapp ?? null
  const rules = await listMemberRules(organizationId)
  const existing = current?.ruleId
    ? rules.find((item) => item.id === current.ruleId)
    : undefined
  let ruleId = existing?.id ?? null
  let approach: tWhatsappApproach
  if (input.approach === 'custom') {
    // Keep the owner's own rule as it is.
    if (!existing || !current)
      throw new ApiError(
        422,
        'whatsapp_rule_missing',
        'Choose what the AI does when someone taps it',
      )
    approach = current.approach
  } else {
    approach = input.approach
    const preset = whatsappRules[approach]
    if (existing?.kind === 'rule') {
      if (existing.text !== preset.text || existing.tag !== preset.tag)
        await updateMemberRule(organizationId, existing.id, preset)
    } else {
      // Steps can't become a one-line rule; replace them.
      if (existing) await deleteMemberRule(organizationId, existing.id)
      const created = await createMemberRules(organizationId, [
        { kind: 'rule', ...preset },
      ])
      ruleId = created.ids[0]
    }
  }
  const saved: iWhatsappQuestion = {
    question: input.question,
    number,
    approach,
    ruleId,
  }
  await writeWhatsapp(assistantId, saved)
  return ownerWhatsapp(saved, await listMemberRules(organizationId))
}

export async function removeWhatsappQuestion(
  organizationId: string,
  assistantId: string,
) {
  const ai = await ownedAssistant(organizationId, assistantId)
  const ruleId = ai.appearance.whatsapp?.ruleId
  if (ruleId) {
    const rules = await listMemberRules(organizationId)
    if (rules.some((item) => item.id === ruleId))
      await deleteMemberRule(organizationId, ruleId)
  }
  await writeWhatsapp(assistantId, null)
}

// HTTP contracts for the AI's rules (docs/yourAi.md, "Rules").
import type {
  tMemberRuleKind,
  tMemberRuleTag,
} from '../config/memberRules.config'
import type { iDraftMissing } from './draft.types'

// GET /organizations/:organizationId/rules, in position order.
export interface iMemberRule {
  id: string
  kind: tMemberRuleKind
  tag: tMemberRuleTag | null
  /** The rule, or the steps' short title. */
  text: string
  /** Steps only: "When someone wants to book a visit". */
  when: string | null
  /** Steps only, in order. */
  steps: string[] | null
  position: number
}

// One rule drafted from the owner's words; saving it is the create route.
export interface iMemberRuleDraft {
  kind: tMemberRuleKind
  tag: tMemberRuleTag | null
  text: string
  when: string | null
  steps: string[] | null
}

export interface iMemberRuleDrafts {
  drafts: iMemberRuleDraft[]
  missing: iDraftMissing[]
}

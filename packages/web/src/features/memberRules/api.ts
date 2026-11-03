import { useCallback, useEffect, useState } from 'react'
import { api } from '../workspace/api'

// The AI's rules (packages/api memberRule.types.ts): how it behaves in a
// conversation, in order.

export type tRuleTag = 'always' | 'never' | 'tone' | 'askFirst' | 'handOver'

export interface iMemberRule {
  id: string
  kind: 'rule' | 'steps'
  tag: tRuleTag | null
  /** The rule, or the steps' short title. */
  text: string
  /** Steps only: "When someone wants to book a visit". */
  when: string | null
  steps: string[] | null
  position: number
}

export type iMemberRuleDraft = Omit<iMemberRule, 'id' | 'position'>

export const ruleTagLabels: Record<tRuleTag, string> = {
  always: 'Always',
  never: 'Never',
  tone: 'Tone',
  askFirst: 'Ask first',
  handOver: 'Hand over',
}

export const ruleLimits = { text: 300, when: 200, step: 200, steps: 10 }

const rulesPath = (organizationId: string) =>
  `/api/organizations/${encodeURIComponent(organizationId)}/rules`

export function draftRules(organizationId: string, text: string) {
  return api<{ drafts: iMemberRuleDraft[] }>(
    `${rulesPath(organizationId)}/drafts`,
    { method: 'POST', body: JSON.stringify({ text }) },
  )
}

/** The draft as the API saves it: only steps carry when and steps. */
export function ruleInput(draft: iMemberRuleDraft) {
  return draft.kind === 'steps'
    ? {
        kind: 'steps' as const,
        text: draft.text,
        when: draft.when ?? draft.text,
        steps: draft.steps ?? [],
        tag: null,
      }
    : {
        kind: 'rule' as const,
        text: draft.text,
        tag: draft.tag,
      }
}

export function saveRules(organizationId: string, drafts: iMemberRuleDraft[]) {
  return api<iMemberRule[]>(rulesPath(organizationId), {
    method: 'POST',
    body: JSON.stringify({ rules: drafts.map(ruleInput) }),
  })
}

export function updateRule(
  organizationId: string,
  ruleId: string,
  changes: Partial<Pick<iMemberRule, 'text' | 'when' | 'steps'>>,
) {
  return api<iMemberRule[]>(
    `${rulesPath(organizationId)}/${encodeURIComponent(ruleId)}`,
    { method: 'PATCH', body: JSON.stringify(changes) },
  )
}

export function removeRule(organizationId: string, ruleId: string) {
  return api<iMemberRule[]>(
    `${rulesPath(organizationId)}/${encodeURIComponent(ruleId)}`,
    { method: 'DELETE' },
  )
}

export function orderRules(organizationId: string, ids: string[]) {
  return api<iMemberRule[]>(`${rulesPath(organizationId)}/order`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
}

/** The AI's rules; null while loading. `version` reloads them. */
export function useMemberRules(organizationId: string | null, version = 0) {
  const key = organizationId ?? ''
  const [state, setState] = useState<{
    key: string
    rules: iMemberRule[] | null
  }>({
    key: '',
    rules: null,
  })
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!organizationId) return
    try {
      const rules = await api<iMemberRule[]>(rulesPath(organizationId))
      setState({ key: organizationId, rules })
      setError('')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Couldn’t load the rules',
      )
    }
  }, [organizationId])
  useEffect(() => {
    void load()
  }, [load, version])
  return {
    rules: state.key === key ? state.rules : null,
    error,
    set: (rules: iMemberRule[]) => setState({ key, rules }),
    reload: load,
  }
}

/** "3 rules, 1 with steps"; "No rules yet". */
export function rulesSummary(rules: iMemberRule[]) {
  const lines = rules.filter((rule) => rule.kind === 'rule').length
  const steps = rules.length - lines
  const parts = [
    lines && `${lines} ${lines === 1 ? 'rule' : 'rules'}`,
    steps && `${steps} with steps`,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'No rules yet'
}

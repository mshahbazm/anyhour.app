// The AI's rules (docs/yourAi.md, "Rules"): how it behaves in a
// conversation. A rule is one line; steps are a short ordered procedure for
// one situation ("When someone wants to book a visit"). Both go into its
// prompts, so their size is bounded here.

export const memberRuleKinds = ['rule', 'steps'] as const
export type tMemberRuleKind = (typeof memberRuleKinds)[number]

// A quiet tag shown next to a rule, inferred when it's drafted; never typed.
export const memberRuleTags = [
  'always',
  'never',
  'tone',
  'askFirst',
  'handOver',
] as const
export type tMemberRuleTag = (typeof memberRuleTags)[number]

export const memberRuleLimits = {
  textLength: 300,
  whenLength: 200,
  stepLength: 200,
  minSteps: 2,
  maxSteps: 10,
  // Rules the workspace's AI can have.
  maxRules: 40,
  // Saved in one request (a drafted card holds at most this many).
  perSave: 10,
} as const

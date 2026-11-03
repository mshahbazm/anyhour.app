// The old per-section guidance on assistant.behaviour. Rules replaced it
// (config/memberRules.config.ts, docs/yourAi.md, "Rules"); the column stays
// for now and nothing reads it.
export type tBehaviourSection =
  | 'qualify'
  | 'recommend'
  | 'convert'
  | 'handoff'
  | 'situations'
  | 'tone'
  | 'avoid'
export type tBehaviour = Partial<Record<tBehaviourSection, string[]>>

import type { tDecisionProviderId } from '../../../config/models.config'
export type tBlockKind = 'knowledge' | 'action' | 'noise' | 'uncertain'
export interface iInlinePart {
  text: string
  url?: string
}
export interface iPageBlock {
  id: string
  text: string
  heading: string
  region: 'main' | 'header' | 'footer' | 'navigation' | 'sidebar'
  links: { label: string; url: string }[]
  inlineParts?: iInlinePart[]
}
export interface iBlockDecision {
  kind: tBlockKind
  confidence: number
}
export interface iPreparationUsage {
  id: string
  inputTokens: number
  outputTokens: number
}
export interface iCleanupCheckpoint {
  /** Provider fields are absent on checkpoints saved before they existed. */
  pendingUsage?: iPreparationUsage & {
    attempt: number
    provider?: tDecisionProviderId
    model?: string
    cachedInputTokens?: number
    costUsd?: string
  }
  /** The model that answered last. */
  model?: string
  decisions: Record<string, iBlockDecision>
  attempts: number
  activeMs: number
  complete: boolean
  reason?: string
  inputTokens: number
  outputTokens: number
  retryAt?: number
}
export interface iSharedText {
  key: string
  text: string
}
export interface iPageProfile {
  summary: string
  purposes: string[]
  topics: string[]
  visitorGoals: string[]
  actions: { label: string; url: string }[]
}

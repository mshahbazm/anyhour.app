import type { tDecisionProviderId } from '../../../../config/models.config'
import { openAiDecisions } from './openai'
import { typeSafeDecisions } from './typesafe'
import type { iDecisionProvider } from './types'

// Decision providers by id (DECISION_PROVIDER). A new provider is one file
// beside these and one line here.
export const decisionProviders = {
  openai: openAiDecisions,
  typesafe: typeSafeDecisions,
} as const satisfies Record<tDecisionProviderId, iDecisionProvider>

// Every AI model the product uses, and for what. Change a model here only.
//
// Language models are OpenAI's GPT-5.6 family, which differ only in how much
// they think: Luna (fast, cheapest), Terra (balanced), Sol (deepest). One-shot
// tasks use the cheapest model that does the job well; chat needs Terra-level
// judgement. GPT-5.6 rejects `temperature`; use reasoning effort instead
// (thinking counts toward max_output_tokens).

/** USD per million tokens, for usage records. */
export interface iPricing {
  inputCostPerMillion: number
  cachedInputCostPerMillion: number
  outputCostPerMillion: number
}

// Who serves each kind of call (services/ai/providers/). Keys belong to a
// vendor (one environment variable each); each capability picks a provider
// (LLM_PROVIDER, DECISION_PROVIDER), and each provider names the vendor whose
// key it needs. Adding a provider widens these ids; the registries and
// configs below then need its entry.
export const vendorKeys = {
  openai: 'OPENAI_API_KEY',
  typesafe: 'TYPESAFE_API_KEY',
  // Page reading (config/pageReaders.config.ts), not a model vendor, but
  // one key per vendor all the same.
  spider: 'SPIDER_API_KEY',
} as const
export type tVendor = keyof typeof vendorKeys

export const llmProviderIds = ['openai'] as const
export type tLlmProviderId = (typeof llmProviderIds)[number]
export const llmProviderVendors = {
  openai: 'openai',
} as const satisfies Record<tLlmProviderId, tVendor>

export const decisionProviderIds = ['openai', 'typesafe'] as const
export type tDecisionProviderId = (typeof decisionProviderIds)[number]
export const decisionProviderVendors = {
  openai: 'openai',
  typesafe: 'typesafe',
} as const satisfies Record<tDecisionProviderId, tVendor>
// How each decision provider is best asked. OpenAI caches the shared input
// (1,024 tokens or more) but bills question text in full on every question,
// so long instructions and criteria go in the input once. Jev reads each
// question with its own criteria.
export const decisionProviderTraits = {
  openai: { instructionsInInput: true },
  typesafe: { instructionsInInput: false },
} as const satisfies Record<
  tDecisionProviderId,
  { instructionsInInput: boolean }
>

/** OpenAI's Flex tier: slower and sometimes unavailable, about half price. */
export type tServiceTier = 'flex'

export const languageModels = {
  luna: {
    id: 'gpt-5.6-luna',
    pricing: {
      inputCostPerMillion: 0.2,
      cachedInputCostPerMillion: 0.02,
      outputCostPerMillion: 1.2,
    },
    flexPricing: {
      inputCostPerMillion: 0.1,
      cachedInputCostPerMillion: 0.01,
      outputCostPerMillion: 0.6,
    },
  },
  terra: {
    id: 'gpt-5.6-terra',
    pricing: {
      inputCostPerMillion: 2,
      cachedInputCostPerMillion: 0.2,
      outputCostPerMillion: 12,
    },
    flexPricing: {
      inputCostPerMillion: 1,
      cachedInputCostPerMillion: 0.1,
      outputCostPerMillion: 6,
    },
  },
  sol: {
    id: 'gpt-5.6-sol',
    pricing: {
      inputCostPerMillion: 5,
      cachedInputCostPerMillion: 0.5,
      outputCostPerMillion: 30,
    },
    flexPricing: {
      inputCostPerMillion: 2,
      cachedInputCostPerMillion: 0.2,
      outputCostPerMillion: 10,
    },
  },
} as const satisfies Record<
  string,
  { id: string; pricing: iPricing; flexPricing?: iPricing }
>

export type tLanguageModel = keyof typeof languageModels
type tEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh'

interface iLlmTask {
  model: tLanguageModel
  effort: tEffort
  max_output_tokens?: number
  timeoutMs: number
  /**
   * 'flex' for background work that can wait (pageProfile,
   * knowledgeOverview, contactDetails, businessHours): about half price, may
   * be slower or busy. Off unless set here.
   */
  serviceTier?: tServiceTier
}

// One-shot calls, by purpose. Each is a bounded job, so Luna is enough; a
// judgement (does this contradict that?) gets a little thinking.
export const llmTasks = {
  // A short profile of each page or document, made while it is read.
  pageProfile: {
    model: 'luna',
    effort: 'none',
    max_output_tokens: 1000,
    timeoutMs: 30_000,
  },
  // What a bot knows overall, rebuilt from those profiles when knowledge changes.
  knowledgeOverview: {
    model: 'luna',
    effort: 'low',
    max_output_tokens: 3000,
    timeoutMs: 60_000,
  },
  // Checks whether search results answer the bot's open questions.
  gapCheck: {
    model: 'luna',
    effort: 'low',
    max_output_tokens: 2000,
    timeoutMs: 45_000,
  },
  // Before saving an owner fact, finds website passages that contradict it.
  factConflict: {
    model: 'luna',
    effort: 'low',
    max_output_tokens: 2000,
    timeoutMs: 30_000,
  },
  // After a page changes, compares it with an owner fact that overrides it.
  correctionCheck: {
    model: 'luna',
    effort: 'low',
    max_output_tokens: 1500,
    timeoutMs: 45_000,
  },
  // Rewrites an owner note to follow the website once they choose it. Room for
  // the longest note (20,000 characters) so a rewrite is never cut short.
  noteRewrite: {
    model: 'luna',
    effort: 'none',
    max_output_tokens: 8000,
    timeoutMs: 120_000,
  },
  // Reads scanned PDFs (no selectable text) into plain text.
  documentTranscription: {
    model: 'luna',
    effort: 'none',
    timeoutMs: 180_000,
  },
  // Turns the business profile into a portrait brief for the image model.
  portraitBrief: {
    model: 'luna',
    effort: 'none',
    timeoutMs: 30_000,
  },
  // Scores a new lead at capture (intent, fit against the ideal customer
  // profile, urgency, 0–100) from its details and chat.
  leadQualification: {
    model: 'luna',
    effort: 'low',
    max_output_tokens: 1200,
    timeoutMs: 30_000,
  },
  // A few "find out first" questions for the AI setup, from the
  // knowledge overview.
  askFirstSuggestions: {
    model: 'luna',
    effort: 'none',
    max_output_tokens: 400,
    timeoutMs: 20_000,
  },
  // After a conversation ends, a few durable facts about the contact
  // ("prefers evenings") for the owner-facing contact memory.
  contactFacts: {
    model: 'luna',
    effort: 'low',
    max_output_tokens: 1200,
    timeoutMs: 30_000,
  },
  // Drafts a member's rules or steps from the owner's words ("never mention
  // discounts", "when someone wants a visit: ask the day, then the address").
  ruleDrafts: {
    model: 'luna',
    effort: 'low',
    max_output_tokens: 2000,
    timeoutMs: 30_000,
  },
  // Drafts one contact from a line like "Ali from Pizza Hub, ali@…".
  contactDrafts: {
    model: 'luna',
    effort: 'low',
    max_output_tokens: 1200,
    timeoutMs: 30_000,
  },
  // After a person answers a conversation that needed them: is the answer
  // general business knowledge worth a note, and if so, the note.
  noteOffer: {
    model: 'luna',
    effort: 'low',
    max_output_tokens: 1200,
    timeoutMs: 20_000,
  },
  // The business's weekly opening hours, read from its notes and the website
  // passages about them (services/workspace/hoursFromKnowledge.ts).
  businessHours: {
    model: 'luna',
    effort: 'low',
    max_output_tokens: 2000,
    timeoutMs: 30_000,
  },
  // A note drafted from what the owner tells the AI on Your business
  // ("We're open 9 to 5, Monday to Friday").
  noteDrafts: {
    model: 'luna',
    effort: 'low',
    max_output_tokens: 2000,
    timeoutMs: 30_000,
  },
  // The business's WhatsApp, phone, email and address, read from its notes
  // and the website passages about them
  // (services/workspace/contactsFromKnowledge.ts).
  contactDetails: {
    model: 'luna',
    effort: 'low',
    max_output_tokens: 1200,
    timeoutMs: 30_000,
  },
  // At a handoff, the reply the AI suggests for the team member to
  // send in the chat. Customer-facing, so the chat tier.
  handoffReply: {
    model: 'terra',
    effort: 'low',
    max_output_tokens: 1500,
    timeoutMs: 45_000,
  },
} as const satisfies Record<string, iLlmTask>

export type tLlmTask = keyof typeof llmTasks

// The two chat agents. Talking to visitors and owners needs judgement, so both
// use Terra. When payment plans exist, the workspace's plan picks the visitor
// chat model (e.g. Luna on an entry plan, Sol on the top one).
export const agentModels = {
  visitorChat: { model: 'terra', effort: 'low', verbosity: 'low' },
  ownerAssistant: { model: 'terra', effort: 'low', verbosity: 'medium' },
} as const satisfies Record<
  string,
  {
    model: tLanguageModel
    effort: tEffort
    verbosity: 'low' | 'medium' | 'high'
  }
>

export type tAgent = keyof typeof agentModels

export interface iUsageTokens {
  inputTokens: number
  /** Part of inputTokens served from the provider's prompt cache. */
  cachedInputTokens?: number
  outputTokens: number
}

/** USD for one call, cached input priced separately when reported. */
export function priceUsd(pricing: iPricing, usage: iUsageTokens) {
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens)
  return (
    ((usage.inputTokens - cached) * pricing.inputCostPerMillion +
      cached * pricing.cachedInputCostPerMillion +
      usage.outputTokens * pricing.outputCostPerMillion) /
    1_000_000
  ).toFixed(10)
}

/** What a language model call cost, on the tier it ran on. */
export function costUsd(
  model: tLanguageModel,
  usage: iUsageTokens,
  serviceTier?: tServiceTier,
) {
  const entry: { pricing: iPricing; flexPricing?: iPricing } =
    languageModels[model]
  return priceUsd(
    (serviceTier === 'flex' && entry.flexPricing) || entry.pricing,
    usage,
  )
}

// Knowledge search: every chunk and question is embedded with this model.
export const embeddingModel = {
  id: 'text-embedding-3-small',
  dimensions: 384,
  inputCostPerMillion: 0.02,
} as const

// Bot profile pictures.
export const imageModel = 'gpt-image-2.5-flare'

// Decision models: typed judgments (yes/no, one choice of several, a score)
// about some input, served by the decision provider (DECISION_PROVIDER).
// OpenAI Decisions is the default, so a new install needs only an OpenAI key;
// TypeSafe Jev is optional.
export const decisionModels = {
  openai: {
    // Output tokens are free; cached input is a tenth of the price.
    'gpt-6-luna': {
      inputCostPerMillion: 0.1,
      cachedInputCostPerMillion: 0.01,
      outputCostPerMillion: 0,
    },
  },
  typesafe: {
    'jev-1.13.0': {
      inputCostPerMillion: 0.042,
      cachedInputCostPerMillion: 0.042,
      outputCostPerMillion: 0,
    },
    'jev-1.14.0': {
      inputCostPerMillion: 0.042,
      cachedInputCostPerMillion: 0.042,
      outputCostPerMillion: 0,
    },
  },
} as const satisfies Record<tDecisionProviderId, Record<string, iPricing>>

/** How big one request may be: estimated JSON bytes and question count. */
export interface iDecisionLimits {
  /** The shared input (page and blocks, or the site's groups). */
  inputBytes: number
  /** The whole request, questions included. */
  requestBytes: number
  questions: number
}

interface iDecisionTask {
  /** The kind its usage is recorded as in ai_usage_event. */
  usageKind: 'cleanup' | 'scopePlan'
  models: { [P in tDecisionProviderId]: keyof (typeof decisionModels)[P] }
  limits: Record<tDecisionProviderId, iDecisionLimits>
  timeoutMs: number
  /** Tries per call, the first included; busy or failing providers retry. */
  attempts: number
}

// OpenAI takes up to 400 questions per request and caches a repeated input
// of 1,024 tokens or more. TypeSafe's limits are its account's: 48 kB per
// request (24 kB of state), two at a time, one start per second.
const openAiLimits = {
  inputBytes: 120_000,
  requestBytes: 600_000,
  questions: 400,
}
const typeSafeLimits = {
  inputBytes: 24_000,
  requestBytes: 48_000,
  questions: 400,
}

export const decisionTasks = {
  // Whether each block of a page is knowledge, an action, noise or uncertain
  // (services/knowledge/cleanup/).
  blockCleanup: {
    usageKind: 'cleanup',
    models: { openai: 'gpt-6-luna', typesafe: 'jev-1.13.0' },
    limits: { openai: openAiLimits, typesafe: typeSafeLimits },
    timeoutMs: 45_000,
    attempts: 3,
  },
  // Which path groups of a new website are articles or listings
  // (services/knowledge/scopePlan.ts). One try: reading never waits on it.
  scopePlan: {
    usageKind: 'scopePlan',
    models: { openai: 'gpt-6-luna', typesafe: 'jev-1.14.0' },
    limits: { openai: openAiLimits, typesafe: typeSafeLimits },
    timeoutMs: 45_000,
    attempts: 1,
  },
} as const satisfies Record<string, iDecisionTask>

export type tDecisionTask = keyof typeof decisionTasks

// Every AI model the product uses, and for what. Change a model here only.
//
// Language models are OpenAI's GPT-5.6 family, which differ only in how much
// they think: Luna (fast, cheapest), Terra (balanced), Sol (deepest). One-shot
// tasks use the cheapest model that does the job well; chat needs Terra-level
// judgement. GPT-5.6 rejects `temperature`; use reasoning effort instead
// (thinking counts toward max_output_tokens).

/** USD per million tokens, for usage records. */
interface iPricing {
  inputCostPerMillion: number
  cachedInputCostPerMillion: number
  outputCostPerMillion: number
}

export const languageModels = {
  luna: {
    id: 'gpt-5.6-luna',
    pricing: {
      inputCostPerMillion: 0.2,
      cachedInputCostPerMillion: 0.02,
      outputCostPerMillion: 1.2,
    },
  },
  terra: {
    id: 'gpt-5.6-terra',
    pricing: {
      inputCostPerMillion: 2,
      cachedInputCostPerMillion: 0.2,
      outputCostPerMillion: 12,
    },
  },
  sol: {
    id: 'gpt-5.6-sol',
    pricing: {
      inputCostPerMillion: 5,
      cachedInputCostPerMillion: 0.5,
      outputCostPerMillion: 30,
    },
  },
} as const satisfies Record<string, { id: string; pricing: iPricing }>

export type tLanguageModel = keyof typeof languageModels
type tEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh'

interface iLlmTask {
  model: tLanguageModel
  effort: tEffort
  max_output_tokens?: number
  timeoutMs: number
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

// The model and settings an agent runs with, in the Agents SDK's shape.
export function agentModel(agent: keyof typeof agentModels) {
  const settings = agentModels[agent]
  return {
    model: languageModels[settings.model].id,
    modelSettings: {
      reasoning: { effort: settings.effort },
      text: { verbosity: settings.verbosity },
    },
  }
}

export function costUsd(
  model: tLanguageModel,
  inputTokens: number,
  outputTokens: number,
) {
  const { pricing } = languageModels[model]
  return (
    (inputTokens * pricing.inputCostPerMillion +
      outputTokens * pricing.outputCostPerMillion) /
    1_000_000
  ).toFixed(10)
}

// Knowledge search: every chunk and question is embedded with this model.
export const embeddingModel = {
  id: 'text-embedding-3-small',
  dimensions: 384,
  inputCostPerMillion: 0.02,
} as const

// Bot profile pictures.
export const imageModel = 'gpt-image-2.5-flare'

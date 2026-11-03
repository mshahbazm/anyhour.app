import type { tTracking } from '../insights/visitorCounts'
import type { iMemberRuleDraft } from '../memberRules/api'
import type { iAppearance } from '@anyhour/widget'
import type { iLeadContact } from '../contacts/types'
import type { tLeadStatus } from '../leads/status'

/** A field the owner's text didn't give, or gave in a form that can't be saved. */
export interface iDraftMissing {
  /** Which draft (0-based). */
  index: number
  field: string
  message: string
}

export interface iOrganization {
  id: string
  name: string
  role?: string
}
export interface iAssistant {
  id: string
  name: string
  pictureKey?: string | null
  goal?: 'answers' | 'enquiries' | 'both' | null
  goalNotes?: string | null
  welcomeMessage: string
  status: string
  allowedOrigins?: string[]
  appearance?: iAppearance
  /** Website insights: visitor counts on (off by default). */
  tracking?: boolean
  /** What visitor counts count while they're on (all on by default). */
  trackingOptions?: Partial<tTracking>
  knowledgeOverview?: iKnowledgeOverview | null
  overviewUpdatedAt?: string | null
  /** One plain sentence: what the AI does. */
  job?: string | null
}

// Mirrors packages/api/src/config/knowledgeOverview.config.ts.
export interface iKnowledgeOverview {
  summary: string
  audience: string | null
  offerings: { name: string; detail: string }[]
  actions: { label: string; url: string }[]
  sources: string[]
  starterQuestions: string[]
}
export interface iWorkspaceContext {
  user: { id: string; name: string; email: string }
  organizations: iOrganization[]
  activeOrganizationId: string | null
}
export interface iWorkspaceChat {
  id: string
  organizationId: string | null
  assistantId: string | null
  title: string
}
export interface iWorkspaceMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: string
  errorCode?: string | null
  /** Said in a chat app (the shared thread); absent from the dashboard. */
  via?: 'whatsapp' | 'slack' | null
}
export interface iWorkspaceAction {
  id: string
  messageId?: string
  name: string
  status: string
  result?: unknown
}
export interface iChatHistory {
  chat: iWorkspaceChat
  messages: iWorkspaceMessage[]
  blocks: iChatBlock[]
  actions: iWorkspaceAction[]
}
export interface iKnowledgeSource {
  id: string
  parentId: string | null
  title: string | null
  kind: string
  fileName: string | null
  inputUrl: string | null
  canonicalUrl: string | null
  status: string
  lastAttemptStatus: string | null
  lastIndexedAt: string | null
  isIncluded: boolean
  lastError: string | null
  archiveNotice: string | null
  archivedAt: string | null
  /** note: facts the owner told the bot in chat. */
  cleanedText?: string | null
  createdAt?: string
  /** Website only: path rules; "/a" covers a folder, "/a$" one page. */
  excludePaths?: string[]
  /** Website only: the exclude rules added before its first read. */
  scopePlan?: {
    rules: Array<{
      rule: string
      kind: 'article' | 'listing' | 'language'
      pages: number
    }>
  } | null
}

export interface iIndexingRun {
  id: string
  status: string
  phase: string
  discoveredCount: number
  indexedCount: number
  failedCount: number
  errorSummary: string | null
}

// A question or summary the agent asks in chat.
export interface iChoicePayload {
  type: 'choice' | 'actions' | 'summary' | 'confirmation'
  title: string
  description: string | null
  options: Array<{ value: string; label: string; description: string | null }>
  items: Array<{ label: string; value: string }>
}

// Rules drafted in the chat (docs/yourAi.md, "Rules").
export interface iRuleDraftPayload {
  type: 'ruleDraft'
  rules: iMemberRuleDraft[]
  status: 'proposed' | 'saved' | 'dismissed'
}

export type tChatBlockPayload = iChoicePayload | iRuleDraftPayload

export interface iChatBlock {
  id: string
  messageId: string
  status: 'pending' | 'resolved' | 'superseded' | 'consumed'
  resolvedValue: string | null
  payload: tChatBlockPayload
}

/** The block's choices, or none for cards that aren't questions. */
export function blockOptions(block: iChatBlock) {
  return 'options' in block.payload && Array.isArray(block.payload.options)
    ? block.payload.options
    : []
}

export type tWorkspaceView =
  // The AI's chat: the first page after sign-in, opening with a briefing.
  | 'assistant'
  | 'business'
  | 'channels'
  | 'conversations'
  | 'leads'
  | 'contacts'
  // The AI's own pages, beside its chat.
  | 'profile'
  | 'rules'

export interface iLead {
  id: string
  assistantId: string
  contactId: string
  title: string
  summary: string | null
  status: tLeadStatus
  /** Minor units (cents); set when won. */
  value: number | null
  closedAt: string | null
  capturedVia: 'chat' | 'manual'
  reason: 'enquiry' | 'question'
  createdAt: string
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  /** The people on the lead, the requester first. */
  contacts?: iLeadContact[]
  /** From the qualification pass at capture; absent until it has run. */
  intent?: 'buy' | 'enquire' | 'support' | 'spam' | null
  score?: number | null
  qualification?: {
    fit: 'strong' | 'possible' | 'poor'
    urgency: 'now' | 'soon' | 'later'
    summary: string
    reasoning: string
  } | null
}

export interface iLeadDetail {
  lead: iLead
  contact: {
    id: string
    name: string | null
    email: string | null
    phone: string | null
  }
  contacts: iLeadContact[]
  notes: Array<{ id: string; body: string; createdAt: string }>
  conversationIds: string[]
}

// A question a visitor asked that the bot couldn't answer (knowledge_gap).
export interface iKnowledgeGap {
  id: string
  question: string
  askCount: number
  lastAskedAt: string | null
  conversationId: string | null
}

// A page that changed and now disagrees with a fact the owner told the bot.
export interface iWebsiteDecision {
  id: string
  noteId: string
  sourceId: string
  noteTitle: string
  ownerSays: string
  websiteBefore: string
  websiteNow: string | null
  page: string | null
  url: string | null
  updatedAt: string
}

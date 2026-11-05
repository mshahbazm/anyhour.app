import { channelNames } from '../../config/channels.config'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { assistant, connection, organization } from '../../db/schema'
import { teamChatLinked } from '../teamChat/linked'
import { workspaceAgentConfig } from '../../config/workspaceAgent.config'
import { openDecisions } from '../knowledge/corrections/corrections'
import { listNotes } from '../knowledge/notes'
import { ownerCatalogueLines, sourceCatalogue } from '../knowledge/catalogue'
import { openKnowledgeGaps } from '../knowledge/gaps/knowledgeGaps'
import { listInstalls } from '../widget/installs'
import { listMemberRules } from '../memberRules/rules'
import { knownWhatsappNumber } from '../whatsappQuestion/knownNumber'
import type { iMemberRule } from '../../types/memberRule.types'
import type { iKnowledgeOverview } from '../../config/knowledgeOverview.config'

// What the system prompt states as already set, read fresh for each turn:
// the selected agent (loadBotFacts) and its workspace (loadWorkspaceFacts).

interface iPromptChat {
  organizationId: string | null
  assistantId: string | null
}

export interface iBotFacts {
  name: string
  /** What it does, in one plain sentence; null until written. */
  job?: string | null
  goal: string | null
  hasPicture: boolean
  status: string
  sources: number
  /** Its rules and steps (docs/yourAi.md, "Rules"). */
  rules: iMemberRule[]
  overview: iKnowledgeOverview | null
  gaps: Array<{ question: string; askCount: number }>
  /** Facts the owner taught, read fresh each turn. */
  notes: Array<{
    title: string
    text: string
    differsFrom: string[]
  }>
  /** What feeds it, from Your business (catalogue.ts). */
  catalogue?: string[]
  decisions: Array<{
    id: string
    page: string | null
    websiteNow: string | null
    ownerSays: string
  }>
  installs: Array<{ origin: string; status: string }>
  /** The channels it answers customers on. */
  channels?: Array<{ channel: string; where: string | null }>
  /** Made in the last few days; its getting-started skill is listed. */
  isNew?: boolean
  /** The WhatsApp question is on, but no WhatsApp number is known. */
  whatsappNumberMissing?: boolean
}

export interface iWorkspaceFacts {
  idealCustomerProfile: string | null
  // Whether alerts can reach someone in a chat app.
  whatsappLinked: boolean
}

// The role and settings the chief of staff works with for this workspace.
export async function loadWorkspaceFacts(
  chat: iPromptChat,
): Promise<iWorkspaceFacts | null> {
  if (!chat.organizationId) return null
  const [[org], linked] = await Promise.all([
    db
      .select({
        idealCustomerProfile: organization.idealCustomerProfile,
      })
      .from(organization)
      .where(eq(organization.id, chat.organizationId)),
    teamChatLinked(chat.organizationId),
  ])
  return {
    idealCustomerProfile: org?.idealCustomerProfile ?? null,
    whatsappLinked: linked,
  }
}

// What's already known about the selected bot, so it never asks again.
export async function loadBotFacts(
  chat: iPromptChat,
): Promise<iBotFacts | null> {
  if (!chat.assistantId) return null
  const [bot] = await db
    .select({
      name: assistant.name,
      job: assistant.job,
      goal: assistant.goal,
      pictureKey: assistant.pictureKey,
      status: assistant.status,
      createdAt: assistant.createdAt,
      overview: assistant.knowledgeOverview,
      organizationId: assistant.organizationId,
      appearance: assistant.appearance,
    })
    .from(assistant)
    .where(eq(assistant.id, chat.assistantId))
    .limit(1)
  if (!bot) return null
  const reader = { organizationId: bot.organizationId }
  const gaps = await openKnowledgeGaps(chat.assistantId, 5)
  const decisions = (await openDecisions(reader)).slice(0, 5)
  const notes = await listNotes(reader)
  const installs = await listInstalls(chat.assistantId)
  const channels = await answeredChannels(chat.assistantId)
  const catalogue = await sourceCatalogue(reader)
  const rules = await listMemberRules(bot.organizationId)
  const whatsappNumberMissing = bot.appearance.whatsapp
    ? !(await knownWhatsappNumber(bot.organizationId)).number
    : false
  return {
    catalogue: ownerCatalogueLines(catalogue),
    installs: installs.map(({ origin, status }) => ({ origin, status })),
    channels,
    gaps: gaps.map(({ question, askCount }) => ({ question, askCount })),
    notes: notes.slice(0, 30).map((note) => ({
      title: note.title,
      text: note.text.slice(0, 400),
      differsFrom: note.overrides.map((item) => item.page),
    })),
    decisions: decisions.map((item) => ({
      id: item.id,
      page: item.page,
      websiteNow: item.websiteNow,
      ownerSays: item.ownerSays.slice(0, 300),
    })),
    name: bot.name,
    job: bot.job,
    goal: bot.goal,
    hasPicture: Boolean(bot.pictureKey),
    status: bot.status,
    isNew:
      Date.now() - bot.createdAt.getTime() <
      workspaceAgentConfig.newForDays * 86_400_000,
    sources: catalogue.sources.length + catalogue.more,
    rules,
    overview: bot.overview,
    whatsappNumberMissing,
  }
}

// Where the AI answers customers: its channels.
async function answeredChannels(assistantId: string) {
  const rows = await db
    .select({
      provider: connection.provider,
      externalAccountId: connection.externalAccountId,
      settings: connection.settings,
    })
    .from(connection)
    .where(
      and(
        eq(connection.assistantId, assistantId),
        eq(connection.status, 'active'),
      ),
    )
    .orderBy(asc(connection.createdAt))
    .limit(20)
  return rows.map((row) => ({
    channel: channelNames[row.provider],
    where:
      row.provider === 'website'
        ? row.externalAccountId
        : (row.settings.displayPhoneNumber ?? row.settings.accountName ?? null),
  }))
}

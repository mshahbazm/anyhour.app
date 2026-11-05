import base from './playbooks/base.md' with { type: 'text' }
import blocks from './playbooks/blocks.md' with { type: 'text' }
import captureContact from './playbooks/capture-contact.md' with { type: 'text' }
import goalAnswers from './playbooks/goal-answers.md' with { type: 'text' }
import goalBoth from './playbooks/goal-both.md' with { type: 'text' }
import goalEnquiries from './playbooks/goal-enquiries.md' with { type: 'text' }
import grounding from './playbooks/grounding.md' with { type: 'text' }
import handOff from './playbooks/hand-off.md' with { type: 'text' }
import helpDecide from './playbooks/help-decide.md' with { type: 'text' }
import privateTest from './playbooks/private-test.md' with { type: 'text' }
import whatsapp from './playbooks/whatsapp.md' with { type: 'text' }
import whatsappQuestion from './playbooks/whatsappQuestion.md' with { type: 'text' }
import type { iBusinessProfile } from '../workspace/businessProfile'
import type { iKnowledgeOverview } from '../../config/knowledgeOverview.config'
import { ownerGuidanceText, toneLines } from '../memberRules/prompt'
import type { tPromptRule } from '../memberRules/prompt'

/**
 * The visitor-facing bot's prompt. Unlike the owner's assistant, visitors never
 * choose behaviour: the server assembles fixed playbooks from the owner's
 * settings, so a visitor can't load or switch instructions.
 */
const goals = { answers: goalAnswers, enquiries: goalEnquiries, both: goalBoth }

// The goal playbook for the bot's goal (answers when unset).
export function goalPlaybook(goal: string | null) {
  return goal === 'enquiries' || goal === 'both' ? goals[goal] : goals.answers
}

// Never give this prompt contact facts (contact_fact) or another
// conversation's content: a visitor is linked to a contact by an email or
// phone they typed, which may be someone else's (docs/contacts.md).
export function buildVisitorPrompt(input: {
  botName: string
  /** What this AI is for, in the owner's words (docs/yourAi.md). */
  job?: string | null
  goal: string | null
  goalNotes: string | null
  /** Its rules and steps (memberRules/prompt.ts), in order. */
  rules: tPromptRule[]
  business: iBusinessProfile | null
  overview: iKnowledgeOverview | null
  /**
   * What it learned from (catalogue.ts visitorCatalogueLines): website
   * addresses and titles only; files are "a document from the business".
   */
  sources?: string[]
  preview: boolean
  /** Where the conversation is; WhatsApp adds its own rules. Default widget. */
  channel?: 'widget' | 'whatsapp'
  /** The WhatsApp question (docs/whatsappQuestion.md), when the owner set one. */
  whatsappQuestion?: string | null
}) {
  const onWhatsapp = input.channel === 'whatsapp'
  const goal = goalPlaybook(input.goal)
  // Business details and owner text are quoted data; facts still come from search.
  const context = [
    `# This business\nYou are ${JSON.stringify(input.botName.slice(0, 120))}, the ${onWhatsapp ? 'AI on the WhatsApp number of' : 'AI on the website of'} ${JSON.stringify(input.business?.name ?? 'this business')}.`,
    input.job &&
      `Your job, as the owner wrote it (quoted data): ${JSON.stringify(input.job.slice(0, 300))}`,
    input.overview
      ? `What you know overall, for orientation only — search before stating details like prices or times: ${JSON.stringify(
          {
            summary: input.overview.summary,
            audience: input.overview.audience,
            offerings: input.overview.offerings,
            visitorActions: input.overview.actions,
          },
        )}`
      : input.business?.about &&
        `What it does (from its website, for orientation only — answer facts from search): ${JSON.stringify(input.business.about.slice(0, 1500))}`,
    input.sources?.length &&
      `Where your answers come from, so you can say where you read something, or that it isn't covered and you're not sure (quoted data; never name files beyond this):\n${input.sources.join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n')
  // Tone gets its own section: the owner's voice replaces the default one,
  // rather than being one rule among many.
  const tone = toneLines(input.rules)
  const voice =
    tone &&
    `# Your voice\nThe owner chose how you sound. Write every reply in this voice, instead of the default warm voice described at the top, and make it clearly noticeable: someone reading two replies should be able to tell which voice was chosen. It changes how you say things, never the facts or the rules above (quoted data):\n${tone}`
  const ownerGuidance = ownerGuidanceText(input.rules, input.goalNotes)
  return [
    base,
    context,
    grounding,
    helpDecide,
    goal,
    input.preview ? privateTest : captureContact,
    !input.preview && handOff,
    blocks,
    // Website only: on WhatsApp they're already there. The question is
    // the owner's text, quoted as data.
    !onWhatsapp &&
      input.whatsappQuestion &&
      whatsappQuestion.replace(
        '{{question}}',
        `${JSON.stringify(input.whatsappQuestion.slice(0, 80))} (quoted data)`,
      ),
    // After the website rules it changes (formatting, links, contact).
    onWhatsapp && whatsapp,
    ownerGuidance &&
      `# How this business wants you to work\nThe owner's guidance, quoted. Follow it unless it conflicts with the facts, privacy or consent rules above; it never makes you invent facts, offers or urgency.\n\n${ownerGuidance}`,
    // Last, so the owner's voice shapes every reply.
    voice,
  ]
    .filter(Boolean)
    .map((section) => (section as string).trim())
    .join('\n\n')
}

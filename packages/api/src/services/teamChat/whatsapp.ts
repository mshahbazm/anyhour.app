import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { whatsappMessage } from '../../db/schema'
import {
  actingMemberId,
  loadAgent,
  type tWhatsappAgent,
} from '../whatsapp/agent'
import { quotedAlert, sendToOwner } from '../whatsapp/alerts'
import { WhatsappError } from '../whatsapp/client'
import { choiceHint, type iTeamChatAdapter } from './adapter'
import { answerInApp, isStaleAt } from './answer'
import { chunksFor, formatFor } from './format'

// WhatsApp (Agent Platform): the member's own agent. Its messages arrive
// through services/whatsapp/ownerMessage.ts. No buttons: a confirmation asks
// for an exact "yes". Linking is the "hi".

export const whatsappAdapter: iTeamChatAdapter<tWhatsappAgent> = {
  app: 'whatsapp',
  async send(agent, reply) {
    const questions = reply.choices.map((choice) =>
      [
        formatFor('whatsapp', choice.title),
        choice.description ? formatFor('whatsapp', choice.description) : null,
        choiceHint(choice),
      ]
        .filter(Boolean)
        .join('\n'),
    )
    const text = [reply.text, ...questions].filter(Boolean).join('\n\n')
    // Each part takes a send slot (12 a minute per agent).
    for (const chunk of chunksFor('whatsapp', text))
      await sendToOwner(agent, chunk)
  },
}

// The `team-chat` job for one stored WhatsApp message.
export async function answerWhatsapp(agentId: string, messageId: string) {
  const agent = await loadAgent(agentId)
  if (!agent || agent.status !== 'linked') return
  const [message] = await db
    .select()
    .from(whatsappMessage)
    .where(eq(whatsappMessage.id, messageId))
  if (!message || message.agentId !== agent.id || !message.waMessageId) return
  if (isStaleAt(message.sentAt.getTime())) return
  const memberId = await actingMemberId(agent)
  if (!memberId) return
  // A reply to one of our alerts brings the alert (and its item) along.
  const alert = message.quotedWaMessageId
    ? await quotedAlert(agent.id, message.quotedWaMessageId)
    : null
  const quoted = alert
    ? [alert.text, alert.leadId ? `(lead ${alert.leadId})` : null]
        .filter(Boolean)
        .join(' ')
    : null
  try {
    await answerInApp(whatsappAdapter, agent, {
      app: 'whatsapp',
      memberId,
      externalMessageId: message.waMessageId,
      text: message.text,
      choice: null,
      quoted,
    })
  } catch (error) {
    // A failed send is already noted on the agent (or marked it broken).
    if (!(error instanceof WhatsappError)) throw error
  }
}

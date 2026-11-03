import { eq } from 'drizzle-orm'
import { whatsappConfig } from '../../config/whatsapp.config'
import { db } from '../../db'
import { whatsappAgent, whatsappMessage } from '../../db/schema'
import type { tWhatsappAgent } from './agent'
import { sendToOwner } from './alerts'
import type { iInboundMessage } from './client'
import { linkOwner } from './link'
import { enqueueTeamChat } from '../queue/boss'

// A member's WhatsApp messages go to the owner assistant as that member
// (services/teamChat/whatsapp.ts). Messages older than ~15 minutes are never
// acted on.

// WhatsApp's timestamp in milliseconds, or null when missing.
function sentAtOf(message: iInboundMessage) {
  const seconds = Number(message.timestamp)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null
}

// Too old (or from the future) to act on.
export function isStale(message: iInboundMessage, now = Date.now()) {
  const at = sentAtOf(message)
  return (
    at === null ||
    now - at > whatsappConfig.staleCommandMinutes * 60_000 ||
    at > now + 60_000
  )
}

// One inbound message, handled at most once (WhatsApp may deliver it again).
// The first message links the member; later ones go to their employee.
export async function handleOwnerMessage(
  agent: tWhatsappAgent,
  message: iInboundMessage,
) {
  const text = message.text?.body?.trim() ?? ''
  const at = sentAtOf(message)
  const [claimed] = await db
    .insert(whatsappMessage)
    .values({
      organizationId: agent.organizationId,
      agentId: agent.id,
      direction: 'in',
      kind: 'owner_message',
      waMessageId: message.id,
      quotedWaMessageId: message.context?.id ?? null,
      text: text.slice(0, 4_000) || `[${message.type || 'message'}]`,
      sentAt: at ? new Date(at) : new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: whatsappMessage.id })
  if (!claimed) return
  if (agent.status === 'waiting_for_hi') {
    await linkOwner(agent, message.from)
    return
  }
  // Only the agent's creator can write to it; their id may change, so the
  // latest sender is who alerts go to.
  if (message.from !== agent.ownerUserId) {
    await db
      .update(whatsappAgent)
      .set({ ownerUserId: message.from })
      .where(eq(whatsappAgent.id, agent.id))
    agent = { ...agent, ownerUserId: message.from }
  }
  if (isStale(message)) return
  if (message.type !== 'text' || !text) {
    await sendToOwner(agent, 'I can only read text messages here for now.')
    return
  }
  // Free text: the employee answers as in the dashboard, one message at a
  // time per person.
  await enqueueTeamChat(
    { source: 'whatsapp', agentId: agent.id, messageId: claimed.id },
    `whatsapp:${agent.id}`,
  )
}

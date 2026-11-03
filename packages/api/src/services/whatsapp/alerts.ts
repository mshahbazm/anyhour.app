import { and, eq, sql } from 'drizzle-orm'
import { whatsappConfig } from '../../config/whatsapp.config'
import { db } from '../../db'
import { whatsappAgent, whatsappMessage } from '../../db/schema'
import type { tWhatsappMessageKind } from '../../db/schema/product/whatsappMessage'
import { agentToken, markBroken, noteError, type tWhatsappAgent } from './agent'
import { sendText, WhatsappError } from './client'

// Waits for the agent's next send slot (12 a minute). The slot is taken in
// the database, so every process sending for this agent shares it.
async function waitForSendSlot(agentId: string) {
  const spacing = whatsappConfig.sendSpacingMs
  if (spacing <= 0) return
  const now = new Date().toISOString()
  const [row] = await db
    .update(whatsappAgent)
    .set({
      nextSendAt: sql`greatest(coalesce(${whatsappAgent.nextSendAt}, ${now}::timestamp), ${now}::timestamp) + make_interval(secs => ${spacing / 1000})`,
    })
    .where(eq(whatsappAgent.id, agentId))
    .returning({ nextSendAt: whatsappAgent.nextSendAt })
  if (!row?.nextSendAt) return
  const wait = row.nextSendAt.getTime() - spacing - Date.now()
  if (wait > 0) await Bun.sleep(wait)
}

// Sends one text to the agent's creator. A rejected key marks it broken.
export async function deliverText(agent: tWhatsappAgent, text: string) {
  if (!agent.ownerUserId)
    throw new WhatsappError('WhatsApp isn’t linked yet', 'rejected', null)
  const token = await agentToken(agent)
  if (token === null)
    throw new WhatsappError(
      'The stored key can’t be read',
      'unauthorized',
      null,
    )
  await waitForSendSlot(agent.id)
  try {
    const id = await sendText(token, agent.ownerUserId, text)
    if (agent.lastError) await noteError(agent.id, null)
    return id
  } catch (error) {
    if (error instanceof WhatsappError) {
      if (error.failure === 'unauthorized')
        await markBroken(agent.id, error.message)
      else await noteError(agent.id, error.message)
    }
    throw error
  }
}

// A message to the agent's creator (alerts, answers, "Connected"), recorded
// with the lead it is about. Returns WhatsApp's message id.
export async function sendToOwner(
  agent: tWhatsappAgent,
  text: string,
  record: { kind: tWhatsappMessageKind; leadId?: string | null } = {
    kind: 'reply',
  },
) {
  const waMessageId = await deliverText(agent, text)
  await db.insert(whatsappMessage).values({
    organizationId: agent.organizationId,
    agentId: agent.id,
    direction: 'out',
    kind: record.kind,
    waMessageId,
    text,
    leadId: record.leadId ?? null,
  })
  return waMessageId
}

// The alert a member's message quoted, among this agent's messages.
export async function quotedAlert(agentId: string, quotedId: string) {
  const [alert] = await db
    .select()
    .from(whatsappMessage)
    .where(
      and(
        eq(whatsappMessage.agentId, agentId),
        eq(whatsappMessage.direction, 'out'),
        eq(whatsappMessage.waMessageId, quotedId),
      ),
    )
    .limit(1)
  return alert ?? null
}

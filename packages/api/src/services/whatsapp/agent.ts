import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { whatsappConfig } from '../../config/whatsapp.config'
import { db } from '../../db'
import { member, user, whatsappAgent } from '../../db/schema'
import { workspaceOwners } from '../workspace/owners'
import { sendEmail } from '../email/send'
import { env } from '../../env'
import { decryptSecret } from './secret'

export type tWhatsappAgent = typeof whatsappAgent.$inferSelect

export async function loadAgent(agentId: string) {
  const [row] = await db
    .select()
    .from(whatsappAgent)
    .where(eq(whatsappAgent.id, agentId))
    .limit(1)
  return row ?? null
}

// Linked agents of these members (all members when omitted), oldest first.
export async function linkedAgents(
  organizationId: string,
  memberIds?: string[],
) {
  if (memberIds && !memberIds.length) return []
  return db
    .select()
    .from(whatsappAgent)
    .where(
      and(
        eq(whatsappAgent.organizationId, organizationId),
        eq(whatsappAgent.status, 'linked'),
        memberIds
          ? inArray(whatsappAgent.connectedByMemberId, memberIds)
          : undefined,
      ),
    )
    .orderBy(asc(whatsappAgent.createdAt))
}

const clip = (message: string) => message.slice(0, whatsappConfig.maxErrorChars)

// WhatsApp rejected the key: stop polling, alert by email until its owner
// pastes a new one. They hear about it once, by email.
export async function markBroken(agentId: string, message: string) {
  const [broken] = await db
    .update(whatsappAgent)
    .set({ status: 'broken', lastError: clip(message) })
    .where(
      and(eq(whatsappAgent.id, agentId), ne(whatsappAgent.status, 'broken')),
    )
    .returning()
  if (!broken?.connectedByMemberId) return
  const [person] = await db
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.id, broken.connectedByMemberId))
  if (!person) return
  await sendEmail({
    to: person.email,
    subject: 'WhatsApp stopped working',
    text: [
      'WhatsApp no longer accepts the key of your agent. It was regenerated, or WhatsApp was reinstalled.',
      'I’m emailing your alerts until you paste the agent’s new key on Channels:',
      `${env.FRONT_END_URL}/channels`,
    ].join('\n\n'),
    idempotencyKey: `whatsapp-broken:${agentId}:${Math.floor(Date.now() / 86_400_000)}`,
  }).catch((error: unknown) =>
    console.error(
      'WhatsApp broken email failed',
      error instanceof Error ? error.name : 'Unknown error',
    ),
  )
}

export async function noteError(agentId: string, message: string | null) {
  await db
    .update(whatsappAgent)
    .set({ lastError: message === null ? null : clip(message) })
    .where(eq(whatsappAgent.id, agentId))
}

// The stored key in clear, or null (and the agent marked broken) when it
// can't be read, e.g. after BETTER_AUTH_SECRET changed.
export async function agentToken(agent: tWhatsappAgent) {
  const token = decryptSecret(agent.tokenEncrypted)
  if (token === null)
    await markBroken(
      agent.id,
      'The stored key can’t be read any more. Paste the agent’s key again.',
    )
  return token
}

// Messages from WhatsApp act as the member whose agent it is; older agents
// without one act as the workspace owner.
export async function actingMemberId(agent: tWhatsappAgent) {
  if (agent.connectedByMemberId) return agent.connectedByMemberId
  const [owner] = await workspaceOwners(agent.organizationId)
  return owner?.memberId ?? null
}

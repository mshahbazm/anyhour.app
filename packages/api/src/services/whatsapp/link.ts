import { and, asc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { member, user, whatsappAgent } from '../../db/schema'
import type {
  iWhatsappAgents,
  iWhatsappAgentView,
} from '../../types/whatsapp.types'
import { findWorkspaceAi, workspaceAi } from '../assistants/workspaceAi'
import { ApiError } from '../http/apiError'
import { enqueueWhatsappPoll } from '../queue/boss'
import { loadAgent, type tWhatsappAgent } from './agent'
import { sendToOwner } from './alerts'
import { getUpdates, WhatsappError } from './client'
import { encryptSecret, secretFingerprint } from './secret'
import { connectedText, testText } from './texts'

// Each team member links their own WhatsApp agent (an agent only talks to
// its creator) to talk with the AI. Owners and admins see everyone's and can
// disconnect any.

interface iViewer {
  memberId: string
  manager: boolean
}

// What Channels shows. Never includes a key.
export async function whatsappAgents(
  organizationId: string,
  viewer: iViewer,
): Promise<iWhatsappAgents> {
  const rows = await db
    .select({ agent: whatsappAgent, memberName: user.name })
    .from(whatsappAgent)
    .leftJoin(member, eq(member.id, whatsappAgent.connectedByMemberId))
    .leftJoin(user, eq(user.id, member.userId))
    .where(eq(whatsappAgent.organizationId, organizationId))
    .orderBy(asc(whatsappAgent.createdAt))
  const agents: iWhatsappAgentView[] = rows
    .filter(
      ({ agent }) =>
        viewer.manager || agent.connectedByMemberId === viewer.memberId,
    )
    .map(({ agent, memberName }) => ({
      id: agent.id,
      status: agent.status,
      memberId: agent.connectedByMemberId,
      memberName,
      mine: agent.connectedByMemberId === viewer.memberId,
      linkedAt: agent.linkedAt?.toISOString() ?? null,
      lastError: agent.lastError,
    }))
    .sort((a, b) => Number(b.mine) - Number(a.mine))
  return { agents }
}

// Checks the key with one immediate poll (the offset is left alone, so
// nothing is consumed), stores it encrypted and waits for the member's "hi".
// Pasting a new key replaces the agent they already linked.
export async function connectWhatsapp(
  organizationId: string,
  viewer: iViewer,
  request: { token: string },
) {
  const input = {
    token: request.token,
    assistantId: (await workspaceAi(organizationId)).id,
  }
  try {
    await getUpdates(input.token, '0', 0)
  } catch (error) {
    if (!(error instanceof WhatsappError)) throw error
    // 409: a poll is already running with this key, so the key works.
    if (error.failure === 'unauthorized' || error.failure === 'forbidden')
      throw new ApiError(
        422,
        'whatsapp_key_rejected',
        'WhatsApp didn’t accept that key. Copy it again from your agent’s chat info.',
      )
    if (error.failure !== 'busy')
      throw new ApiError(
        503,
        'whatsapp_unavailable',
        'WhatsApp didn’t answer. Try again in a minute.',
      )
  }
  const fingerprint = secretFingerprint(input.token)
  const [elsewhere] = await db
    .select({ id: whatsappAgent.id })
    .from(whatsappAgent)
    .where(eq(whatsappAgent.tokenFingerprint, fingerprint))
    .limit(1)
  const [same] = await db
    .select({ id: whatsappAgent.id })
    .from(whatsappAgent)
    .where(
      and(
        eq(whatsappAgent.organizationId, organizationId),
        eq(whatsappAgent.connectedByMemberId, viewer.memberId),
      ),
    )
  if (elsewhere && elsewhere.id !== same?.id)
    throw new ApiError(
      409,
      'whatsapp_in_use',
      'This agent is already linked. Create a new agent in WhatsApp.',
    )
  const fresh = {
    tokenEncrypted: encryptSecret(input.token),
    tokenFingerprint: fingerprint,
    ownerUserId: null,
    pollOffset: '0',
    status: 'waiting_for_hi' as const,
    linkedAt: null,
    lastPolledAt: null,
    lastError: null,
    nextSendAt: null,
  }
  const [saved] = same
    ? await db
        .update(whatsappAgent)
        .set({ ...fresh, assistantId: input.assistantId })
        .where(eq(whatsappAgent.id, same.id))
        .returning()
    : await db
        .insert(whatsappAgent)
        .values({
          organizationId,
          connectedByMemberId: viewer.memberId,
          assistantId: input.assistantId,
          ...fresh,
        })
        .returning()
  await enqueueWhatsappPoll(saved.id)
  return whatsappAgents(organizationId, viewer)
}

// The agent if this person may change it: their own, or any for managers.
async function agentFor(
  organizationId: string,
  agentId: string,
  viewer: iViewer,
) {
  const agent = await loadAgent(agentId)
  if (
    !agent ||
    agent.organizationId !== organizationId ||
    (!viewer.manager && agent.connectedByMemberId !== viewer.memberId)
  )
    throw new ApiError(
      404,
      'whatsapp_missing',
      'That WhatsApp agent isn’t linked',
    )
  return agent
}

// Forgets the key. The running poll job notices and stops.
export async function disconnectWhatsapp(
  organizationId: string,
  agentId: string,
  viewer: iViewer,
) {
  const agent = await agentFor(organizationId, agentId, viewer)
  await db.delete(whatsappAgent).where(eq(whatsappAgent.id, agent.id))
}

// A test message from the agent to the member who linked it (only theirs).
export async function sendTestMessage(
  organizationId: string,
  agentId: string,
  viewer: iViewer,
) {
  const agent = await agentFor(organizationId, agentId, {
    ...viewer,
    manager: false,
  })
  if (agent.status !== 'linked')
    throw new ApiError(
      409,
      'whatsapp_not_linked',
      'Send your agent “hi” in WhatsApp first.',
    )
  const ai = await findWorkspaceAi(agent.organizationId)
  try {
    await sendToOwner(agent, testText(ai?.name ?? null))
  } catch (error) {
    if (!(error instanceof WhatsappError)) throw error
    throw new ApiError(
      503,
      'whatsapp_unavailable',
      'WhatsApp didn’t take the message. Try again in a minute.',
    )
  }
}

// The member's first message to the agent tells us who to message: link them
// and say so in WhatsApp too.
export async function linkOwner(agent: tWhatsappAgent, ownerUserId: string) {
  const [linked] = await db
    .update(whatsappAgent)
    .set({
      ownerUserId,
      status: 'linked',
      linkedAt: new Date(),
      lastError: null,
    })
    .where(
      and(
        eq(whatsappAgent.id, agent.id),
        eq(whatsappAgent.status, 'waiting_for_hi'),
      ),
    )
    .returning()
  if (!linked) return null
  const ai = await findWorkspaceAi(linked.organizationId)
  await sendToOwner(linked, connectedText(ai?.name ?? null))
  return linked
}

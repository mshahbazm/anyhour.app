import { and, eq } from 'drizzle-orm'
import type { tTeamChatApp } from '../../config/teamChat.config'
import { db } from '../../db'
import { member, workspaceChat, workspaceMessage } from '../../db/schema'
import { findWorkspaceAi } from '../assistants/workspaceAi'

// One thread per person with the AI, shared by the dashboard, WhatsApp and
// Slack: an ordinary owner chat (workspaceChat) marked shared, so each side
// sees what was said on the others (docs/focusedProduct.md, "One AI per
// business").

export const ownerThreadTitle = 'Chat'

export async function memberOf(memberId: string) {
  const [row] = await db
    .select({
      id: member.id,
      userId: member.userId,
      organizationId: member.organizationId,
      role: member.role,
    })
    .from(member)
    .where(eq(member.id, memberId))
  return row ?? null
}

/** The person's thread with the workspace's AI; null before the AI exists. */
export async function ownerThread(userId: string, organizationId: string) {
  const ai = await findWorkspaceAi(organizationId)
  if (!ai) return null
  const match = and(
    eq(workspaceChat.userId, userId),
    eq(workspaceChat.organizationId, organizationId),
    eq(workspaceChat.assistantId, ai.id),
    eq(workspaceChat.shared, true),
  )
  const [existing] = await db.select().from(workspaceChat).where(match)
  if (existing) return existing
  await db
    .insert(workspaceChat)
    .values({
      userId,
      organizationId,
      assistantId: ai.id,
      shared: true,
      title: ownerThreadTitle,
    })
    .onConflictDoNothing()
  const [created] = await db.select().from(workspaceChat).where(match)
  return created ?? null
}

// An alert the member got in an app joins their thread with the AI, so a
// reply ("tell them yes") has it as context, and the dashboard shows it.
// Once per thread and alert.
export async function recordAlert(input: {
  memberId: string
  app: tTeamChatApp
  text: string
  alertKey: string
}) {
  const person = await memberOf(input.memberId)
  if (!person) return
  const thread = await ownerThread(person.userId, person.organizationId)
  if (!thread) return
  const now = new Date()
  await db
    .insert(workspaceMessage)
    .values({
      chatId: thread.id,
      clientMessageId: `alert:${input.alertKey}`,
      role: 'assistant',
      content: input.text,
      via: input.app,
      createdAt: now,
      completedAt: now,
    })
    .onConflictDoNothing()
  await db
    .update(workspaceChat)
    .set({ updatedAt: now })
    .where(eq(workspaceChat.id, thread.id))
}

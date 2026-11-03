import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { assistant, contact, conversation } from '../../db/schema'
import type { iHandoffSummary } from '../../db/schema/product/conversation'
import { env } from '../../env'
import { workspaceOwners } from '../workspace/owners'
import { sendEmail } from '../email/send'
import { ApiError } from '../http/apiError'
import { alertTeam } from '../teamChat/notify'
import { draftHandoffReply } from './draftReply'
import { conversationLeadIds } from './conversations'

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const clip = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text

export function inboxUrl(conversationId: string) {
  return `${env.FRONT_END_URL.replace(/\/+$/, '')}/conversations/${conversationId}`
}

// What the owner reads in the alert. The summary comes from the visitor's
// words, so it is quoted and kept to plain lines.
export function handoffAlertText(input: {
  who: string
  botName: string
  summary: iHandoffSummary
  conversationId: string
}) {
  const quoted = (text: string) => `“${clip(oneLine(text), 280)}”`
  return [
    `${clip(oneLine(input.who), 120)} needs a person`,
    `They want: ${quoted(input.summary.wants)}`,
    input.summary.known && `What we know: ${quoted(input.summary.known)}`,
    input.summary.nextStep &&
      `Suggested next step: ${quoted(input.summary.nextStep)}`,
    '',
    `${input.botName} told them a person will reply in the chat. Reply here: ${inboxUrl(input.conversationId)}`,
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n')
}

// The AI passes the conversation to a person: it records why and alerts the
// owners once until the conversation is resolved (a person replies or hands
// it back). The visitor keeps chatting with the AI until a member replies.
export async function handOffConversation(input: {
  assistantId: string
  conversationId: string
  reason: iHandoffSummary['reason']
  wants: string
  known?: string | null
  nextStep?: string | null
}) {
  const summary: iHandoffSummary = {
    reason: input.reason,
    wants: clip(input.wants.trim(), 500),
    known: input.known?.trim() ? clip(input.known.trim(), 500) : null,
    nextStep: input.nextStep?.trim() ? clip(input.nextStep.trim(), 300) : null,
  }
  const outcome = await db.transaction(async (tx) => {
    const [found] = await tx
      .select({
        chat: conversation,
        organizationId: assistant.organizationId,
        botName: assistant.name,
      })
      .from(conversation)
      .innerJoin(assistant, eq(assistant.id, conversation.assistantId))
      .where(
        and(
          eq(conversation.id, input.conversationId),
          eq(conversation.assistantId, input.assistantId),
        ),
      )
      .for('update', { of: conversation })
    if (!found || found.chat.isTest)
      throw new ApiError(
        403,
        'preview_handoff_forbidden',
        'Test chats can’t be handed off',
      )
    const { chat } = found
    // Already waiting for, or with, a person: no second alert.
    const alreadyWithTeam =
      chat.needsHumanSince !== null || chat.handledBy === 'human'
    const since = chat.needsHumanSince ?? new Date()
    await tx
      .update(conversation)
      .set({
        needsHumanSince: since,
        handoffSummary: summary,
        // A new handoff (the one that alerts) counts toward "needed you".
        ...(alreadyWithTeam ? {} : { handedOffAt: since }),
      })
      .where(eq(conversation.id, chat.id))
    return {
      organizationId: found.organizationId,
      botName: found.botName,
      contactId: chat.contactId,
      alreadyWithTeam,
      since,
    }
  })
  if (!outcome.alreadyWithTeam) {
    const leadIds = await conversationLeadIds(db, input.conversationId)
    await alertHandoff({
      organizationId: outcome.organizationId,
      conversationId: input.conversationId,
      contactId: outcome.contactId,
      assistantId: input.assistantId,
      botName: outcome.botName,
      summary,
      since: outcome.since,
      leadId: leadIds[0] ?? null,
    })
  }
  // The suggested reply is written in the background; the visitor's answer
  // never waits for it.
  void draftHandoffReply(input.conversationId).catch((error: unknown) =>
    console.error(
      'Handoff draft failed',
      error instanceof Error ? error.name : 'Unknown error',
    ),
  )
  return {
    contactKnown: Boolean(outcome.contactId),
    alerted: !outcome.alreadyWithTeam,
  }
}

// Email to every owner always, and their chat apps too when linked. A failed
// alert never undoes the handoff: the conversation still waits in Needs you.
async function alertHandoff(input: {
  organizationId: string
  conversationId: string
  contactId: string | null
  assistantId: string
  botName: string
  summary: iHandoffSummary
  since: Date
  leadId: string | null
}) {
  const [person] = input.contactId
    ? await db
        .select({
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
        })
        .from(contact)
        .where(eq(contact.id, input.contactId))
    : []
  const who = person?.name || person?.email || person?.phone || 'A visitor'
  const text = handoffAlertText({
    who,
    botName: input.botName,
    summary: input.summary,
    conversationId: input.conversationId,
  })
  try {
    const owners = await workspaceOwners(input.organizationId)
    for (const person of owners)
      await sendEmail({
        to: person.email,
        subject: `Needs you: ${clip(oneLine(who), 120)}`,
        text,
        // One alert per person and handoff, however often it's asked for.
        idempotencyKey: `handoff:${input.conversationId}:${input.since.getTime()}:${person.memberId}`,
      }).catch((error: unknown) =>
        console.error(
          'Handoff email failed',
          error instanceof Error ? error.message : 'Unknown error',
        ),
      )
  } catch (error) {
    console.error(
      'Handoff email failed',
      error instanceof Error ? error.name : 'Unknown error',
    )
  }
  try {
    await alertTeam({
      organizationId: input.organizationId,
      recipients: await workspaceOwners(input.organizationId),
      text,
      leadId: input.leadId,
      alertKey: `handoff:${input.conversationId}:${input.since.getTime()}`,
    })
  } catch (error) {
    console.error(
      'Handoff chat app alert failed',
      error instanceof Error ? error.name : 'Unknown error',
    )
  }
}

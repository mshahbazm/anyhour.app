import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import {
  assistant,
  contact,
  lead,
  leadConversation,
  message,
  organization,
} from '../../db/schema'
import { env } from '../../env'
import { contactFactTexts } from '../contacts/memory'
import { describeQualification } from './qualify'

// A lead with what owner alerts read about it: contact, the bot that captured it and the workspace name, plus what the
// business remembers about the contact (owner-facing only; never the
// visitor bot).
export async function loadLeadView(leadId: string) {
  const [row] = await db
    .select({
      lead,
      contactName: contact.name,
      contactEmail: contact.email,
      contactPhone: contact.phone,
      botName: assistant.name,
      businessName: organization.name,
    })
    .from(lead)
    .innerJoin(contact, eq(contact.id, lead.contactId))
    .innerJoin(assistant, eq(assistant.id, lead.assistantId))
    .innerJoin(organization, eq(organization.id, lead.organizationId))
    .where(eq(lead.id, leadId))
    .limit(1)
  if (!row) return null
  return {
    ...row,
    contactFacts: await contactFactTexts(
      row.lead.organizationId,
      row.lead.contactId,
    ),
  }
}

export type tLeadView = NonNullable<Awaited<ReturnType<typeof loadLeadView>>>

// The lead's latest visitor and bot messages across its conversations,
// oldest first.
export async function recentLeadMessages(leadId: string, limit: number) {
  const links = await db
    .select({ id: leadConversation.conversationId })
    .from(leadConversation)
    .where(eq(leadConversation.leadId, leadId))
  if (!links.length) return []
  const rows = await db
    .select({
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    })
    .from(message)
    .where(
      and(
        inArray(
          message.conversationId,
          links.map((link) => link.id),
        ),
        inArray(message.role, ['visitor', 'assistant', 'staff']),
        eq(message.status, 'completed'),
      ),
    )
    .orderBy(desc(message.createdAt), desc(message.id))
    .limit(limit)
  return rows.reverse().map((row) => ({
    role:
      row.role === 'visitor'
        ? ('visitor' as const)
        : row.role === 'staff'
          ? ('owner' as const)
          : ('bot' as const),
    text: row.content,
    at: row.createdAt.toISOString(),
  }))
}

// The dashboard page of a lead.
export function leadUrl(leadId: string) {
  return `${env.FRONT_END_URL.replace(/\/+$/, '')}/leads/${leadId}`
}

export function leadDisplayName(view: tLeadView) {
  return (
    view.contactName?.trim() ||
    view.contactEmail ||
    view.contactPhone ||
    'A lead'
  )
}

// Who the lead is, what they asked for and what I remember about them, as
// plain-text lines for the owner (never sent to the lead).
export function leadSummaryLines(view: tLeadView) {
  const record = view.lead
  const details = [view.contactEmail, view.contactPhone].filter(Boolean)
  const qualification = record.qualification
  return [
    `${leadDisplayName(view)}${details.length ? ` (${details.join(', ')})` : ''}`,
    `${record.title} · ${record.status}`,
    ...(record.summary ? ['', record.summary] : []),
    ...(qualification && record.intent && record.score !== null
      ? [
          '',
          describeQualification({
            score: record.score,
            fit: qualification.fit,
            intent: record.intent,
          }),
          qualification.summary,
        ]
      : []),
    ...(view.contactFacts.length
      ? [
          '',
          'What I remember about them:',
          ...view.contactFacts.map((fact) => `- ${fact}`),
        ]
      : []),
    '',
    `Open the lead: ${leadUrl(record.id)}`,
  ]
}

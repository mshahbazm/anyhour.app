import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  assistant,
  contact,
  conversation,
  lead,
  leadContact,
  leadConversation,
  message,
} from '../../db/schema'
import { suppliedContactDetails } from './contactDetails'
import {
  lockIdentities,
  matchingIdentities,
  normalizeEmail,
  normalizePhone,
  recordIdentity,
} from '../contacts/identities'
import { ApiError } from '../http/apiError'
import { writeActivity } from './activity'
import { enqueueLeadCaptured } from '../queue/boss'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

type tContactInput = { name?: string; email?: string; phone?: string }

function normalized(input: tContactInput) {
  const email = input.email?.trim() ? normalizeEmail(input.email) : null
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : null
  if (!email && !phone)
    throw new ApiError(422, 'contact_required', 'Email or phone is required')
  return { email, phone }
}

async function capture(
  tx: tTransaction,
  organizationId: string,
  assistantId: string,
  input: tContactInput & {
    title: string
    summary?: string
    reason?: 'enquiry' | 'question'
    capturedVia: 'chat'
    conversationId?: string
  },
) {
  const { email, phone } = normalized(input)
  const details = [
    email && {
      kind: 'email' as const,
      value: input.email!.trim(),
      normalizedValue: email,
    },
    phone && {
      kind: 'phone' as const,
      value: input.phone!.trim(),
      normalizedValue: phone,
    },
  ].filter((detail) => !!detail)
  // A person is found by any way of reaching them they've used before.
  await lockIdentities(tx, organizationId, details)
  const owners = await matchingIdentities(tx, organizationId, details)
  const ownerIds = [...new Set(owners.map((item) => item.contactId))]
  if (ownerIds.length > 1)
    throw new ApiError(
      409,
      'contact_conflict',
      'Email and phone belong to different contacts',
    )
  const matches = ownerIds.length
    ? await tx
        .select()
        .from(contact)
        .where(eq(contact.id, ownerIds[0]))
        .for('update')
    : []
  let person = matches[0]
  if (!person) {
    ;[person] = await tx
      .insert(contact)
      .values({
        organizationId,
        name: input.name?.trim() || null,
        email: input.email?.trim() || null,
        normalizedEmail: email,
        phone: input.phone?.trim() || null,
        normalizedPhone: phone,
      })
      .returning()
  } else {
    ;[person] = await tx
      .update(contact)
      .set({
        name: person.name || input.name?.trim() || null,
        email: person.email || input.email?.trim() || null,
        normalizedEmail: person.normalizedEmail || email,
        phone: person.phone || input.phone?.trim() || null,
        normalizedPhone: person.normalizedPhone || phone,
      })
      .where(eq(contact.id, person.id))
      .returning()
  }
  for (const detail of details)
    await recordIdentity(tx, {
      organizationId,
      contactId: person.id,
      ...detail,
      source: input.capturedVia,
    })
  // Preserve existing values; retain conflicting submitted details on the enquiry.
  const submittedDetails = matches[0]
    ? [
        input.name?.trim() && input.name.trim() !== person.name
          ? `Submitted name: ${input.name.trim()}`
          : null,
        email && email !== person.normalizedEmail
          ? `Submitted email: ${input.email?.trim()}`
          : null,
        phone && phone !== person.normalizedPhone
          ? `Submitted phone: ${input.phone?.trim()}`
          : null,
      ].filter((detail): detail is string => !!detail)
    : []
  const [request] = await tx
    .insert(lead)
    .values({
      organizationId,
      assistantId,
      contactId: person.id,
      title: input.title.trim() || 'New enquiry',
      summary:
        [input.summary?.trim(), ...submittedDetails]
          .filter(Boolean)
          .join('\n') || null,
      capturedVia: input.capturedVia,
      reason: input.reason ?? 'enquiry',
    })
    .returning()
  await tx
    .insert(leadContact)
    .values({ leadId: request.id, contactId: person.id, role: 'requester' })
  await writeActivity(tx, {
    organizationId,
    leadId: request.id,
    kind: 'captured',
    title: 'Captured from chat',
    detail: { capturedVia: input.capturedVia, reason: request.reason },
  })
  if (input.conversationId) {
    await tx
      .insert(leadConversation)
      .values({ leadId: request.id, conversationId: input.conversationId })
    await tx
      .update(conversation)
      .set({ contactId: person.id })
      .where(eq(conversation.id, input.conversationId))
  }
  return { contact: person, lead: request }
}

// Once a capture has committed: qualification and the owners'
// alert run in the lead-captured job. A lost job only costs those; the lead
// itself is saved.
async function afterCapture(leadId: string) {
  try {
    await enqueueLeadCaptured(leadId)
  } catch (error) {
    console.error(
      'Lead captured enqueue failed',
      error instanceof Error ? error.name : 'Unknown error',
    )
  }
}

export async function captureChatLead(
  assistantId: string,
  conversationId: string,
  turnKey: string,
  input: tContactInput & {
    title: string
    summary?: string
    reason?: 'enquiry' | 'question'
  },
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const [chat] = await db
    .select({
      isTest: conversation.isTest,
      channel: conversation.channel,
      knownFields: conversation.knownFields,
    })
    .from(conversation)
    .where(
      and(
        eq(conversation.id, conversationId),
        eq(conversation.assistantId, assistantId),
      ),
    )
    .limit(1)
  if (!chat || chat.isTest)
    throw new ApiError(
      403,
      'preview_capture_forbidden',
      'Preview conversations cannot create leads',
    )
  const [owner] = await db
    .select({ organizationId: assistant.organizationId })
    .from(assistant)
    .where(eq(assistant.id, assistantId))
    .limit(1)
  if (!owner)
    throw new ApiError(404, 'assistant_missing', 'Assistant not found')
  const visitorMessages = await db
    .select({ content: message.content })
    .from(message)
    .where(
      and(
        eq(message.conversationId, conversationId),
        eq(message.role, 'visitor'),
      ),
    )
  const supplied = suppliedContactDetails(
    [
      ...visitorMessages.map((item) => item.content),
      // On WhatsApp, Meta verified the number they write from.
      ...(chat.channel === 'whatsapp' && chat.knownFields.phone
        ? [chat.knownFields.phone]
        : []),
    ],
    input,
  )
  if (!supplied.email && !supplied.phone)
    throw new ApiError(
      422,
      'contact_not_supplied',
      'Contact detail must come from this conversation',
    )
  input = { ...input, ...supplied }
  const outcome = await db.transaction(async (tx) => {
    signal.throwIfAborted()
    const key = `${turnKey}:lead`
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${conversationId}:${key}`}))`,
    )
    const [previous] = await tx
      .select()
      .from(message)
      .where(
        and(
          eq(message.conversationId, conversationId),
          eq(message.clientMessageId, key),
        ),
      )
      .limit(1)
    if (previous) {
      const id = JSON.parse(previous.content) as string
      const [request] = await tx
        .select()
        .from(lead)
        .where(eq(lead.id, id))
        .limit(1)
      if (request) return { lead: request, created: false }
    }
    const result = await capture(tx, owner.organizationId, assistantId, {
      ...input,
      conversationId,
      capturedVia: 'chat',
    })
    signal.throwIfAborted()
    await tx.insert(message).values({
      conversationId,
      role: 'tool',
      content: JSON.stringify(result.lead.id),
      clientMessageId: key,
      completedAt: new Date(),
    })
    const [chat] = await tx
      .select()
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .limit(1)
    await tx
      .update(conversation)
      .set({
        knownFields: {
          ...chat.knownFields,
          ...(input.name ? { name: input.name } : {}),
          ...(input.email ? { email: input.email } : {}),
          ...(input.phone ? { phone: input.phone } : {}),
        },
      })
      .where(eq(conversation.id, conversationId))
    return { ...result, created: true }
  })
  const { created, ...result } = outcome
  if (created) await afterCapture(result.lead.id)
  return result
}

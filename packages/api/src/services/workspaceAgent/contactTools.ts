import { tool } from '@openai/agents'
import { z } from 'zod'
import type {
  iContact,
  iContactDetail,
  iContactFact,
  iContactListItem,
  iLeadContact,
} from '../../types/contact.types'
import { ApiError } from '../http/apiError'
import { createWorkspaceApiClient } from './apiClient'
import type { tExecute } from './managementTools'
import { ownedChat } from './store'
import type { iWorkspaceToolContext } from './tools'

// Contacts and what the business remembers about them: every call goes
// through the HTTP API as the signed-in user, so each route re-checks the
// workspace and the user's permission.

export function buildContactTools(
  ctx: iWorkspaceToolContext,
  execute: tExecute,
) {
  const request = createWorkspaceApiClient(
    ctx.headers,
    ctx.dispatch,
    ctx.signal,
  )
  async function workspaceBase() {
    const chat = await ownedChat(ctx.headers, ctx.chatId)
    if (!chat.organizationId)
      throw new ApiError(409, 'workspace_required', 'Create a workspace first')
    return `/api/organizations/${encodeURIComponent(chat.organizationId)}`
  }
  async function contactsBase() {
    return `${await workspaceBase()}/contacts`
  }
  const contactId = z.string().min(1)
  const brief = (item: iContact) => ({
    id: item.id,
    name: item.name,
    email: item.email,
    phone: item.phone,
  })
  return [
    tool({
      name: 'find_contacts',
      description:
        'Search the workspace’s contacts (people) by name, email or phone, newest first; null lists the latest. Returns IDs for contact_details (read-only).',
      parameters: z.object({ query: z.string().trim().max(200).nullable() }),
      execute: execute('find_contacts', async ({ query }) => {
        const search = new URLSearchParams({ limit: '20' })
        if (query) search.set('q', query)
        const contacts = await request<iContactListItem[]>(
          `${await contactsBase()}?${search}`,
        )
        return contacts.map((item) => ({
          id: item.id,
          name: item.name,
          email: item.email,
          phone: item.phone,
          openDeals: item.openDealCount,
          lastActivityAt: item.lastActivityAt,
        }))
      }),
    }),
    tool({
      name: 'contact_details',
      description:
        'Read one contact: ways to reach them, remembered facts (with IDs for forget_contact_fact), deals (with lead IDs), conversations and recent activity (read-only).',
      parameters: z.object({ contactId }),
      execute: execute('contact_details', async ({ contactId }) => {
        const detail = await request<iContactDetail>(
          `${await contactsBase()}/${encodeURIComponent(contactId)}`,
        )
        return {
          id: detail.contact.id,
          name: detail.contact.name,
          reach: detail.identities.map((item) => ({
            kind: item.kind,
            value: item.value,
          })),
          facts: detail.facts.map((fact) => ({
            id: fact.id,
            text: fact.text,
            learnedFrom:
              fact.source === 'agent' ? 'a conversation' : 'a person',
            createdAt: fact.createdAt,
          })),
          deals: detail.deals.map((deal) => ({
            leadId: deal.id,
            title: deal.title,
            status: deal.status,
            role: deal.role,
          })),
          conversations: detail.conversations.slice(0, 5).map((item) => ({
            bot: item.assistantName,
            status: item.status,
            lastMessageAt: item.lastMessageAt,
            lastMessage: item.lastMessage
              ? {
                  from: item.lastMessage.role,
                  text: item.lastMessage.content,
                }
              : null,
          })),
          activity: detail.activities.slice(0, 10).map((item) => ({
            deal: item.leadTitle,
            title: item.title,
            at: item.createdAt,
          })),
        }
      }),
    }),
    tool({
      name: 'remember_contact_fact',
      description:
        'Save one short, durable fact the user tells you about a contact (e.g. "prefers evenings"). Never save secrets, card or payment details, or health details beyond what the business needs.',
      parameters: z.object({
        contactId,
        text: z.string().trim().min(1).max(500),
      }),
      execute: execute(
        'remember_contact_fact',
        async ({ contactId, text }) => {
          const fact = await request<iContactFact>(
            `${await contactsBase()}/${encodeURIComponent(contactId)}/facts`,
            'POST',
            { text },
          )
          return { id: fact.id, text: fact.text }
        },
        true,
      ),
    }),
    tool({
      name: 'forget_contact_fact',
      description:
        'Delete one remembered fact from a contact at the user’s request, using a fact ID from contact_details.',
      parameters: z.object({ contactId, factId: z.string().min(1) }),
      execute: execute(
        'forget_contact_fact',
        async ({ contactId, factId }) => {
          await request(
            `${await contactsBase()}/${encodeURIComponent(contactId)}/facts/${encodeURIComponent(factId)}`,
            'DELETE',
          )
          return { forgotten: factId }
        },
        true,
      ),
    }),
    tool({
      name: 'add_contact',
      description:
        'Add a person the user names as a contact. Needs an email or a phone in international format (+44…). If someone already has that email or phone, returns identity_taken with their contactId instead.',
      parameters: z.object({
        name: z.string().trim().max(200).nullable(),
        email: z.string().trim().max(320).nullable(),
        phone: z.string().trim().max(40).nullable(),
      }),
      execute: execute(
        'add_contact',
        async (input) =>
          brief(await request<iContact>(await contactsBase(), 'POST', input)),
        true,
      ),
    }),
    tool({
      name: 'update_contact',
      description: 'Change a contact’s name.',
      parameters: z.object({
        contactId,
        name: z.string().trim().min(1).max(200),
      }),
      execute: execute(
        'update_contact',
        async ({ contactId, name }) =>
          brief(
            await request<iContact>(
              `${await contactsBase()}/${encodeURIComponent(contactId)}`,
              'PATCH',
              { name },
            ),
          ),
        true,
      ),
    }),
    tool({
      name: 'add_lead_person',
      description:
        'Add a contact to a lead with their role, or change the role of someone already on it. The person who enquired is already on it as the requester.',
      parameters: z.object({
        leadId: z.string().min(1),
        contactId,
        role: z.enum([
          'decision_maker',
          'point_of_contact',
          'billing',
          'other',
        ]),
      }),
      execute: execute(
        'add_lead_person',
        async ({ leadId, contactId, role }) => {
          const path = `${await workspaceBase()}/leads/${encodeURIComponent(leadId)}/contacts`
          const people = await request<iLeadContact[]>(path, 'POST', {
            contactId,
            role,
          }).catch(async (error: unknown) => {
            // Already on the lead: change their role instead.
            if (error instanceof ApiError && error.code === 'contact_on_lead')
              return request<iLeadContact[]>(
                `${path}/${encodeURIComponent(contactId)}`,
                'PATCH',
                { role },
              )
            throw error
          })
          return people.map((item) => ({
            id: item.id,
            name: item.name,
            role: item.role,
          }))
        },
        true,
      ),
    }),
  ]
}

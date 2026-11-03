import { api } from '../workspace/api'
import type { iInboxConversation, iInboxMessage, tInboxFilter } from './types'

const base = (organizationId: string) => `/api/organizations/${organizationId}`
const conversationPath = (organizationId: string, conversationId: string) =>
  `${base(organizationId)}/conversations/${encodeURIComponent(conversationId)}`

/** For usePagedList: newest activity first. */
export const inboxPath = (organizationId: string, filter: tInboxFilter) =>
  `${base(organizationId)}/conversations?filter=${filter}`

export const getConversation = (
  organizationId: string,
  conversationId: string,
) => api<iInboxConversation>(conversationPath(organizationId, conversationId))

/** Sends a staff reply; the team has the conversation from then on. */
export const sendReply = (
  organizationId: string,
  conversationId: string,
  content: string,
) =>
  api<iInboxMessage>(
    `${conversationPath(organizationId, conversationId)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ content }),
    },
  )

/** Hands the conversation back to the AI. */
export const releaseConversation = (
  organizationId: string,
  conversationId: string,
) =>
  api<iInboxConversation>(
    `${conversationPath(organizationId, conversationId)}/release`,
    { method: 'POST' },
  )

/** "Not now" on the offer to remember a reply. */
export const dismissNoteOffer = (
  organizationId: string,
  conversationId: string,
  messageId: string,
) =>
  api<null>(
    `${conversationPath(organizationId, conversationId)}/messages/${encodeURIComponent(messageId)}/note-offer`,
    { method: 'DELETE' },
  )

// Mirrors POST .../notes/conflicts in packages/api/src/routes/knowledge.routes.ts.
export interface iNoteConflicts {
  conflicts: Array<{ sourceIds: string[]; page: string; pageSays: string }>
  youWillSay: string | null
}

/** Website pages that disagree with a fact before it's saved. */
export const noteConflicts = (
  organizationId: string,
  assistantId: string,
  note: { title: string; text: string },
  /** The note being updated, when it already exists. */
  noteId: string | null = null,
) =>
  api<iNoteConflicts>(
    `${base(organizationId)}/assistants/${encodeURIComponent(assistantId)}/notes/conflicts`,
    {
      method: 'POST',
      body: JSON.stringify({ noteId, ...note }),
    },
  )

/** Saves a reply's answer as a note in Your business (an answer learned). */
export const saveLearnedNote = (
  organizationId: string,
  note: {
    title: string
    text: string
    fromMessageId: string
    overrides?: Array<{ sourceId: string; excerpt: string }>
  },
) =>
  api<{ id: string }>(`${base(organizationId)}/business/notes`, {
    method: 'POST',
    body: JSON.stringify(note),
  })

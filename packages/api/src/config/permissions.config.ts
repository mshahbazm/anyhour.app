import { createAccessControl } from 'better-auth/plugins/access'
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from 'better-auth/plugins/organization/access'

export const statements = {
  ...defaultStatements,
  // The workspace's one AI: made at sign-up, never added or deleted.
  assistant: ['read', 'update'],
  lead: ['read', 'update'],
  // Contacts, their identities and facts, and merges.
  contact: ['read', 'update'],
  integration: ['create', 'read', 'update', 'delete'],
  // The inbox: reading visitor conversations and replying as staff.
  conversation: ['read', 'reply'],
} as const

export const ac = createAccessControl(statements)

export const roles = {
  owner: ac.newRole({
    ...ownerAc.statements,
    assistant: ['read', 'update'],
    lead: ['read', 'update'],
    contact: ['read', 'update'],
    integration: ['create', 'read', 'update', 'delete'],
    conversation: ['read', 'reply'],
  }),
  admin: ac.newRole({
    ...adminAc.statements,
    assistant: ['read', 'update'],
    lead: ['read', 'update'],
    contact: ['read', 'update'],
    integration: ['create', 'read', 'update', 'delete'],
    conversation: ['read', 'reply'],
  }),
  member: ac.newRole({
    ...memberAc.statements,
    assistant: ['read'],
    lead: ['read', 'update'],
    contact: ['read', 'update'],
    integration: ['read'],
    conversation: ['read', 'reply'],
  }),
} as const

// What a workspace API key may do: the WordPress plugin reads and re-reads
// its website in Your business (assistant read and update). Everything else
// (leads, contacts, conversations, settings, the team, keys) stays
// session-only.
export const apiKeyPermissions: Partial<
  Record<keyof typeof statements, readonly string[]>
> = {
  assistant: ['read', 'update'],
}

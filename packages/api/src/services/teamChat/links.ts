import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNotNull } from 'drizzle-orm'
import { teamChatAppNames, teamChatConfig } from '../../config/teamChat.config'
import { db } from '../../db'
import {
  assistant,
  connection,
  connectionMember,
  member,
  organization,
} from '../../db/schema'
import { env } from '../../env'
import type { iTeamChatLink } from '../../types/connection.types'
import { ApiError } from '../http/apiError'

// Slack people link to a team member through a one-time link the
// employee sends them. Until then it answers them with that link only. The
// link names no one: whoever opens it, signed in as a member of the
// workspace, becomes that person, so it is only ever sent to them directly
// (a DM, or a message only they can see).

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

// The member a Slack user linked, or null.
export async function linkedMember(
  connectionId: string,
  externalUserId: string,
) {
  const [row] = await db
    .select({ memberId: connectionMember.memberId })
    .from(connectionMember)
    .where(
      and(
        eq(connectionMember.connectionId, connectionId),
        eq(connectionMember.externalUserId, externalUserId),
        isNotNull(connectionMember.memberId),
      ),
    )
  return row?.memberId ?? null
}

// A fresh link for this person (any earlier one stops working).
export async function createLinkUrl(
  connectionId: string,
  externalUserId: string,
  dmChannelId?: string | null,
) {
  const token = randomBytes(24).toString('base64url')
  const values = {
    linkTokenHash: hash(token),
    linkExpiresAt: new Date(Date.now() + teamChatConfig.linkMinutes * 60_000),
    ...(dmChannelId ? { dmChannelId } : {}),
  }
  await db
    .insert(connectionMember)
    .values({ connectionId, externalUserId, ...values })
    .onConflictDoUpdate({
      target: [connectionMember.connectionId, connectionMember.externalUserId],
      set: values,
    })
  return `${env.FRONT_END_URL}/link/${token}`
}

export const linkPromptText = (url: string) =>
  `Link your account to talk to me here: ${url}\nThe link works once, for ${teamChatConfig.linkMinutes} minutes.`

async function pendingLink(token: string) {
  const [row] = await db
    .select({
      id: connectionMember.id,
      connectionId: connectionMember.connectionId,
      organizationId: connection.organizationId,
      provider: connection.provider,
      settings: connection.settings,
      workspaceName: organization.name,
      employeeName: assistant.name,
    })
    .from(connectionMember)
    .innerJoin(connection, eq(connection.id, connectionMember.connectionId))
    .innerJoin(organization, eq(organization.id, connection.organizationId))
    .leftJoin(assistant, eq(assistant.id, connection.assistantId))
    .where(
      and(
        eq(connectionMember.linkTokenHash, hash(token)),
        gt(connectionMember.linkExpiresAt, new Date()),
      ),
    )
  if (!row)
    throw new ApiError(
      404,
      'link_expired',
      'This link has expired or was already used. Message your AI again for a new one.',
    )
  return row
}

async function membershipIn(organizationId: string, userId: string) {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, userId)),
    )
  if (!row)
    throw new ApiError(
      403,
      'organization_forbidden',
      'Sign in with the account you use for this workspace.',
    )
  return row
}

function view(row: Awaited<ReturnType<typeof pendingLink>>): iTeamChatLink {
  // Links are only made for team chat apps, never the customer number.
  const app = row.provider as iTeamChatLink['app']
  return {
    app,
    appName: teamChatAppNames[app],
    accountName: row.settings.accountName ?? null,
    workspaceName: row.workspaceName,
    employeeName: row.employeeName ?? null,
  }
}

// What the landing page shows before the member links.
export async function linkPreview(token: string, userId: string) {
  const row = await pendingLink(token)
  await membershipIn(row.organizationId, userId)
  return view(row)
}

// Links the signed-in member and spends the token.
export async function redeemLink(token: string, userId: string) {
  const row = await pendingLink(token)
  const membership = await membershipIn(row.organizationId, userId)
  const [linked] = await db
    .update(connectionMember)
    .set({
      memberId: membership.id,
      linkedAt: new Date(),
      linkTokenHash: null,
      linkExpiresAt: null,
    })
    .where(
      and(
        eq(connectionMember.id, row.id),
        eq(connectionMember.linkTokenHash, hash(token)),
      ),
    )
    .returning()
  if (!linked)
    throw new ApiError(404, 'link_expired', 'This link was already used.')
  return { link: view(row), connectionMember: linked }
}

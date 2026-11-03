import { createHash, randomBytes } from 'node:crypto'
import { and, asc, eq, isNull, lt, or } from 'drizzle-orm'
import { apiKeyConfig } from '../../config/integrations.config'
import { db } from '../../db'
import { apiKey, member } from '../../db/schema'
import { ApiError } from '../http/apiError'

// `wp_live_` + 32 random bytes, base64url (43 characters).
export const generateApiKey = () =>
  `${apiKeyConfig.prefix}${randomBytes(32).toString('base64url')}`

export const hashApiKey = (key: string) =>
  createHash('sha256').update(key).digest('hex')

const keyPattern = /^Bearer\s+(wp_live_[A-Za-z0-9_-]{43})\s*$/

// True when a request presents a workspace API key instead of a session, so
// organization routes authenticate it as the key (see requirePermission).
export const carriesApiKey = (headers: Headers) =>
  /^Bearer\s+wp_live_/.test(headers.get('authorization') ?? '')

// Authenticates a public API request by its workspace API key. Only the hash
// is stored, so the lookup is by hash. lastUsedAt is written at most once a
// minute per key so busy integrations don't turn every read into a write.
export async function requireApiKey(headers: Headers): Promise<{
  organizationId: string
  apiKeyId: string
  createdByMemberId: string | null
}> {
  const match = keyPattern.exec(headers.get('authorization') ?? '')
  if (!match)
    throw new ApiError(401, 'invalid_api_key', 'A valid API key is required')
  const [found] = await db
    .select({
      id: apiKey.id,
      organizationId: apiKey.organizationId,
      lastUsedAt: apiKey.lastUsedAt,
      createdByMemberId: apiKey.createdByMemberId,
    })
    .from(apiKey)
    .where(
      and(eq(apiKey.keyHash, hashApiKey(match[1])), isNull(apiKey.revokedAt)),
    )
    .limit(1)
  if (!found)
    throw new ApiError(401, 'invalid_api_key', 'A valid API key is required')
  const now = new Date()
  const stale = new Date(
    now.getTime() - apiKeyConfig.touchIntervalSeconds * 1000,
  )
  if (!found.lastUsedAt || found.lastUsedAt < stale)
    await db
      .update(apiKey)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiKey.id, found.id),
          or(isNull(apiKey.lastUsedAt), lt(apiKey.lastUsedAt, stale)),
        ),
      )
  return {
    organizationId: found.organizationId,
    apiKeyId: found.id,
    createdByMemberId: found.createdByMemberId,
  }
}

// The member a key's actions are recorded as (timelines, notes):
// whoever created it while they're in the workspace, otherwise its owner.
export async function apiKeyMember(
  organizationId: string,
  createdByMemberId: string | null,
) {
  const [creator] = createdByMemberId
    ? await db
        .select()
        .from(member)
        .where(
          and(
            eq(member.id, createdByMemberId),
            eq(member.organizationId, organizationId),
          ),
        )
        .limit(1)
    : []
  if (creator) return creator
  const [owner] = await db
    .select()
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.role, 'owner')),
    )
    .orderBy(asc(member.createdAt))
    .limit(1)
  if (!owner)
    throw new ApiError(
      403,
      'organization_forbidden',
      'Organization access denied',
    )
  return owner
}

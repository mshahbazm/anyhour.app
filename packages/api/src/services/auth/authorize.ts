import { and, eq } from 'drizzle-orm'
import { getAuth } from '../../auth/auth'
import { apiKeyPermissions, roles } from '../../config/permissions.config'
import { db } from '../../db'
import { member } from '../../db/schema'
import { ApiError } from '../http/apiError'
import { apiKeyMember, carriesApiKey, requireApiKey } from './apiKeyAuth'

type tResource =
  | 'assistant'
  | 'lead'
  | 'contact'
  | 'integration'
  | 'conversation'
  | 'organization'
  | 'member'
  | 'invitation'
type tAction = 'create' | 'read' | 'update' | 'delete' | 'cancel' | 'reply'

// Who an API-key request acts as. `user` is the key's acting member's user,
// so per-person limits and preview ownership still have someone to name.
export interface iApiKeySession {
  user: { id: string }
  apiKeyId: string
}

export async function requireSession(headers: Headers) {
  const session = await getAuth().api.getSession({ headers })
  if (!session) throw new ApiError(401, 'unauthorized', 'Sign in required')
  return session
}

// A request with `Authorization: Bearer wp_live_…` is the key's workspace
// acting with an admin's rights, limited to apiKeyPermissions; everything
// else (billing, team, workspace settings) stays session-only.
async function requireApiKeyPermission(
  headers: Headers,
  organizationId: string,
  resource: tResource,
  action: tAction,
) {
  const key = await requireApiKey(headers)
  if (key.organizationId !== organizationId)
    throw new ApiError(
      403,
      'organization_forbidden',
      'Organization access denied',
    )
  const allowed =
    apiKeyPermissions[resource]?.includes(action) &&
    roles.admin.authorize({ [resource]: [action] }).success
  if (!allowed)
    throw new ApiError(
      403,
      'api_key_forbidden',
      'API keys cannot do this; sign in to the dashboard instead',
    )
  const membership = await apiKeyMember(organizationId, key.createdByMemberId)
  const session: iApiKeySession = {
    user: { id: membership.userId },
    apiKeyId: key.apiKeyId,
  }
  return { session, membership }
}

export async function requirePermission(
  headers: Headers,
  organizationId: string,
  resource: tResource,
  action: tAction,
) {
  if (carriesApiKey(headers))
    return requireApiKeyPermission(headers, organizationId, resource, action)
  const session = await requireSession(headers)
  const [membership] = await db
    .select()
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.userId, session.user.id),
      ),
    )
    .limit(1)
  if (!membership)
    throw new ApiError(
      403,
      'organization_forbidden',
      'Organization access denied',
    )
  const role = membership.role as keyof typeof roles
  if (!(role in roles))
    throw new ApiError(403, 'role_forbidden', 'Role access denied')
  const allowed = roles[role].authorize({ [resource]: [action] })
  if (!allowed.success)
    throw new ApiError(403, 'permission_denied', 'Permission denied')
  return { session, membership }
}

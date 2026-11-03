import { roles } from '../../config/permissions.config'
import { carriesApiKey } from '../auth/apiKeyAuth'
import { requirePermission } from '../auth/authorize'
import { ApiError } from '../http/apiError'

// Who is asking on Channels: any member links their own chat apps; owners
// and admins (integration:update) also manage everyone's. Session only: an
// API key has no phone or Slack account.
export async function teamChatViewer(headers: Headers, organizationId: string) {
  if (carriesApiKey(headers))
    throw new ApiError(
      403,
      'api_key_forbidden',
      'API keys cannot do this; sign in to the dashboard instead',
    )
  const { membership } = await requirePermission(
    headers,
    organizationId,
    'integration',
    'read',
  )
  const role = roles[membership.role as keyof typeof roles]
  return {
    memberId: membership.id,
    manager: Boolean(role?.authorize({ integration: ['update'] }).success),
  }
}

import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db'
import { organization } from '../db/schema'
import { requireApiKey } from '../services/auth/apiKeyAuth'
import { ApiError } from '../services/http/apiError'
import type { iApiKeyIdentity } from '../types/integration.types'

// The public API, authenticated with a workspace API key. The WordPress
// plugin calls it to find its workspace, then re-reads the site through the
// Your business routes (/api/organizations/:org/business/sources), which
// accept the key too.
export const publicApiRoutes = new Hono()

// Which workspace a key belongs to, so clients need only the key.
publicApiRoutes.get('/me', async (c) => {
  const { organizationId } = await requireApiKey(c.req.raw.headers)
  const [found] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  if (!found)
    throw new ApiError(404, 'workspace_missing', 'Workspace not found')
  const body: iApiKeyIdentity = {
    organizationId,
    organizationName: found.name,
  }
  return c.json(body)
})

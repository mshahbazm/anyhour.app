import { and, asc, count, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { apiKeyConfig } from '../config/integrations.config'
import { db } from '../db'
import { apiKey } from '../db/schema'
import { createApiKeySchema } from '../schemas/apiKey.schema'
import { generateApiKey, hashApiKey } from '../services/auth/apiKeyAuth'
import { requirePermission } from '../services/auth/authorize'
import { ApiError } from '../services/http/apiError'
import { validateJson } from '../services/http/validateJson'
import type {
  iApiKey,
  iApiKeyList,
  iCreatedApiKey,
} from '../types/integration.types'

export const apiKeyRoutes = new Hono()

const toApiKey = (row: typeof apiKey.$inferSelect): iApiKey => ({
  id: row.id,
  name: row.name,
  keyPrefix: row.keyPrefix,
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

const active = (organizationId: string) =>
  and(eq(apiKey.organizationId, organizationId), isNull(apiKey.revokedAt))

// Revoked keys are not listed.
apiKeyRoutes.get('/:organizationId/api-keys', async (c) => {
  const organizationId = c.req.param('organizationId')
  await requirePermission(
    c.req.raw.headers,
    organizationId,
    'integration',
    'read',
  )
  const rows = await db
    .select()
    .from(apiKey)
    .where(active(organizationId))
    .orderBy(asc(apiKey.createdAt))
  const body: iApiKeyList = { apiKeys: rows.map(toApiKey) }
  return c.json(body)
})

apiKeyRoutes.post(
  '/:organizationId/api-keys',
  validateJson(createApiKeySchema),
  async (c) => {
    const organizationId = c.req.param('organizationId')
    const { membership } = await requirePermission(
      c.req.raw.headers,
      organizationId,
      'integration',
      'create',
    )
    const [{ total }] = await db
      .select({ total: count() })
      .from(apiKey)
      .where(active(organizationId))
    if (total >= apiKeyConfig.maxActivePerWorkspace)
      throw new ApiError(
        409,
        'api_key_limit',
        `A workspace can have up to ${apiKeyConfig.maxActivePerWorkspace} API keys`,
      )
    const key = generateApiKey()
    const [row] = await db
      .insert(apiKey)
      .values({
        organizationId,
        name: c.req.valid('json').name,
        keyHash: hashApiKey(key),
        keyPrefix: key.slice(0, apiKeyConfig.visiblePrefixLength),
        createdByMemberId: membership.id,
      })
      .returning()
    // The only time the full key leaves the server.
    const body: iCreatedApiKey = { ...toApiKey(row), key }
    return c.json(body, 201)
  },
)

apiKeyRoutes.delete('/:organizationId/api-keys/:apiKeyId', async (c) => {
  const { organizationId, apiKeyId } = c.req.param()
  await requirePermission(
    c.req.raw.headers,
    organizationId,
    'integration',
    'delete',
  )
  const [revoked] = await db
    .update(apiKey)
    .set({ revokedAt: new Date() })
    .where(and(active(organizationId), eq(apiKey.id, apiKeyId)))
    .returning({ id: apiKey.id })
  if (!revoked) throw new ApiError(404, 'api_key_missing', 'API key not found')
  return c.body(null, 204)
})

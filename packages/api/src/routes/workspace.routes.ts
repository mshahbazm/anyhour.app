import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { organization } from '../db/schema'
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
} from '../schemas/workspace.schema'
import { requirePermission } from '../services/auth/authorize'
import { createOnboardedWorkspace } from '../services/workspace/createWorkspace'
import { monthStats } from '../services/workspace/monthStats'
import { validateJson } from '../services/http/validateJson'
import { ApiError } from '../services/http/apiError'

const workspaceFields = {
  id: organization.id,
  name: organization.name,
  businessAbout: organization.businessAbout,
  idealCustomerProfile: organization.idealCustomerProfile,
  timeZone: organization.timeZone,
  businessHours: organization.businessHours,
}

// Mounted at /api/workspaces: sign-up onboarding creates the workspace.
export const newWorkspaceRoutes = new Hono()

newWorkspaceRoutes.post('/', validateJson(createWorkspaceSchema), async (c) =>
  c.json(
    await createOnboardedWorkspace(c.req.raw.headers, c.req.valid('json')),
    201,
  ),
)

// Mounted at /api/organizations.
export const workspaceRoutes = new Hono()
workspaceRoutes.get('/:organizationId/workspace', async (c) => {
  const id = c.req.param('organizationId')
  await requirePermission(c.req.raw.headers, id, 'assistant', 'read')
  const [record] = await db
    .select(workspaceFields)
    .from(organization)
    .where(eq(organization.id, id))
  if (!record)
    throw new ApiError(404, 'workspace_missing', 'Workspace not found')
  return c.json(record)
})
workspaceRoutes.patch(
  '/:organizationId/workspace',
  validateJson(updateWorkspaceSchema),
  async (c) => {
    const id = c.req.param('organizationId')
    await requirePermission(c.req.raw.headers, id, 'organization', 'update')
    const [record] = await db
      .update(organization)
      .set(c.req.valid('json'))
      .where(eq(organization.id, id))
      .returning(workspaceFields)
    return c.json(record)
  },
)

// This month's numbers: customers answered, leads caught and won, times it
// needed a person, answers learned.
workspaceRoutes.get('/:organizationId/stats/month', async (c) => {
  const id = c.req.param('organizationId')
  await requirePermission(c.req.raw.headers, id, 'conversation', 'read')
  return c.json(await monthStats(id))
})

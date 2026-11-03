import { Hono } from 'hono'
import {
  connectWhatsappBusinessSchema,
  updateConnectionSchema,
} from '../schemas/connection.schema'
import { connectWhatsappBusiness } from '../services/customerWhatsapp/connect'
import { requirePermission, requireSession } from '../services/auth/authorize'
import { receiveWebhook } from '../services/connections/events'
import {
  connectionChannels,
  disconnectConnection,
  finishInstall,
  startInstall,
  updateConnection,
} from '../services/connections/install'
import { providerFor } from '../services/connections/registry'
import { connectionList } from '../services/connections/store'
import { ApiError } from '../services/http/apiError'
import { validateJson } from '../services/http/validateJson'
import { linkPreview, redeemLink } from '../services/teamChat/links'
import { tellLinked } from '../services/teamChat/notify'
import { teamChatViewer } from '../services/teamChat/viewer'
import type {
  iConnectionChannel,
  iConnectionList,
  iTeamChatLink,
  tUpdatedConnection,
} from '../types/connection.types'

// Connections on the Channels page (docs/channels.md, "Wave 3a"): Slack, the
// business's WhatsApp number and its website chat channels, all answered by
// the workspace's AI.
// Everyone sees them and whether they linked their own account; owners and
// admins connect, configure and disconnect.
export const connectionRoutes = new Hono()

connectionRoutes.get('/:organizationId/connections', async (c) => {
  const organizationId = c.req.param('organizationId')
  const viewer = await teamChatViewer(c.req.raw.headers, organizationId)
  const body: iConnectionList = await connectionList(
    organizationId,
    viewer.memberId,
  )
  return c.json(body)
})

// Where to send the browser to install our app for the AI.
connectionRoutes.post(
  '/:organizationId/connections/:provider/install',
  async (c) => {
    const { organizationId, provider } = c.req.param()
    const { membership } = await requirePermission(
      c.req.raw.headers,
      organizationId,
      'integration',
      'update',
    )
    return c.json(
      await startInstall({
        organizationId,
        memberId: membership.id,
        provider,
      }),
    )
  },
)

// The business's own WhatsApp number for customers: pasted, not OAuth.
connectionRoutes.post(
  '/:organizationId/connections/whatsapp_business',
  validateJson(connectWhatsappBusinessSchema),
  async (c) => {
    const organizationId = c.req.param('organizationId')
    const { membership } = await requirePermission(
      c.req.raw.headers,
      organizationId,
      'integration',
      'update',
    )
    const body: iConnectionList = await connectWhatsappBusiness({
      organizationId,
      memberId: membership.id,
      ...c.req.valid('json'),
    })
    return c.json(body, 201)
  },
)

// A provider's settings (integration:update). Returns the changed
// connection with the whole list.
connectionRoutes.patch(
  '/:organizationId/connections/:connectionId',
  validateJson(updateConnectionSchema),
  async (c) => {
    const { organizationId, connectionId } = c.req.param()
    const input = c.req.valid('json')
    const { membership } = await requirePermission(
      c.req.raw.headers,
      organizationId,
      'integration',
      'update',
    )
    const body: tUpdatedConnection = await updateConnection(
      organizationId,
      connectionId,
      membership.id,
      input,
    )
    return c.json(body)
  },
)

connectionRoutes.get(
  '/:organizationId/connections/:connectionId/channels',
  async (c) => {
    const { organizationId, connectionId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'integration',
      'update',
    )
    const body: iConnectionChannel[] = await connectionChannels(
      organizationId,
      connectionId,
    )
    return c.json(body)
  },
)

connectionRoutes.delete(
  '/:organizationId/connections/:connectionId',
  async (c) => {
    const { organizationId, connectionId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'integration',
      'update',
    )
    await disconnectConnection(organizationId, connectionId)
    return c.body(null, 204)
  },
)

// Provider-facing: OAuth callbacks (the browser comes back signed in) and
// signed webhooks (no session: the signature is the authority).
export const connectRoutes = new Hono()

connectRoutes.get('/:provider/callback', async (c) => {
  const provider = providerFor(c.req.param('provider'))
  if (!provider) throw new ApiError(404, 'provider_missing', 'Not found')
  const { code, state, error } = c.req.query()
  return c.redirect(
    await finishInstall(provider.id, { code, state, error }, c.req.raw.headers),
  )
})

// Meta checks the webhook URL with a GET before it sends anything.
connectRoutes.get('/:provider/webhook', (c) => {
  const provider = providerFor(c.req.param('provider'))
  if (!provider?.challenge || !provider.available())
    return c.text('Not found', 404)
  return provider.challenge(new URL(c.req.url).searchParams)
})

connectRoutes.post('/:provider/webhook', (c) =>
  receiveWebhook(c.req.param('provider'), c.req.raw),
)

// The "Link your account" page: the signed-in member links the Slack
// account the one-time link was sent to.
export const teamChatLinkRoutes = new Hono()

teamChatLinkRoutes.get('/links/:token', async (c) => {
  const session = await requireSession(c.req.raw.headers)
  const body: iTeamChatLink = await linkPreview(
    c.req.param('token'),
    session.user.id,
  )
  return c.json(body)
})

teamChatLinkRoutes.post('/links/:token', async (c) => {
  const session = await requireSession(c.req.raw.headers)
  const { link, connectionMember } = await redeemLink(
    c.req.param('token'),
    session.user.id,
  )
  await tellLinked(connectionMember)
  const body: iTeamChatLink = link
  return c.json(body)
})

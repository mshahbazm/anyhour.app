import { Hono } from 'hono'
import { connectWhatsappSchema } from '../schemas/whatsapp.schema'
import { validateJson } from '../services/http/validateJson'
import { teamChatViewer } from '../services/teamChat/viewer'
import {
  connectWhatsapp,
  disconnectWhatsapp,
  sendTestMessage,
  whatsappAgents,
} from '../services/whatsapp/link'
import type { iWhatsappAgents } from '../types/whatsapp.types'

// Personal WhatsApp agents (docs/teamChat.md): every member links their own
// to talk with the AI; owners and admins see and can remove everyone's.
// Keys are write-only.
export const whatsappRoutes = new Hono()

whatsappRoutes.get('/:organizationId/whatsapp', async (c) => {
  const organizationId = c.req.param('organizationId')
  const viewer = await teamChatViewer(c.req.raw.headers, organizationId)
  const body: iWhatsappAgents = await whatsappAgents(organizationId, viewer)
  return c.json(body)
})

// Checks the key with WhatsApp, stores it encrypted and waits for the
// member's first message.
whatsappRoutes.post(
  '/:organizationId/whatsapp',
  validateJson(connectWhatsappSchema),
  async (c) => {
    const organizationId = c.req.param('organizationId')
    const viewer = await teamChatViewer(c.req.raw.headers, organizationId)
    const body: iWhatsappAgents = await connectWhatsapp(
      organizationId,
      viewer,
      c.req.valid('json'),
    )
    return c.json(body)
  },
)

whatsappRoutes.delete('/:organizationId/whatsapp/:agentId', async (c) => {
  const { organizationId, agentId } = c.req.param()
  const viewer = await teamChatViewer(c.req.raw.headers, organizationId)
  await disconnectWhatsapp(organizationId, agentId, viewer)
  return c.body(null, 204)
})

// "Send me a test": one message from the agent to its own member.
whatsappRoutes.post('/:organizationId/whatsapp/:agentId/test', async (c) => {
  const { organizationId, agentId } = c.req.param()
  const viewer = await teamChatViewer(c.req.raw.headers, organizationId)
  await sendTestMessage(organizationId, agentId, viewer)
  return c.body(null, 204)
})

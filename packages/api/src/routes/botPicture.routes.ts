import { Hono } from 'hono'
import { createBotPictureSchema } from '../schemas/assistant.schema'
import { requirePermission } from '../services/auth/authorize'
import {
  createBotPicture,
  readBotPicture,
  removeBotPicture,
} from '../services/assistants/botPicture'
import { validateJson } from '../services/http/validateJson'
import { limitPublicRequest } from '../services/widget/access'

export const botPictureRoutes = new Hono()
const path = '/:organizationId/assistants/:assistantId/picture'

botPictureRoutes.get(path, async (c) => {
  const { organizationId, assistantId } = c.req.param()
  await requirePermission(
    c.req.raw.headers,
    organizationId,
    'assistant',
    'read',
  )
  const picture = await readBotPicture(organizationId, assistantId)
  return c.body(new Uint8Array(picture.body), 200, {
    'content-type': picture.contentType,
    // The URL carries the picture key, so a new picture gets a new URL.
    'cache-control': 'private, max-age=86400',
  })
})

botPictureRoutes.post(path, validateJson(createBotPictureSchema), async (c) => {
  const { organizationId, assistantId } = c.req.param()
  const { session } = await requirePermission(
    c.req.raw.headers,
    organizationId,
    'assistant',
    'update',
  )
  // Image generation is slow and paid: a few per minute per person.
  await limitPublicRequest(
    {
      assistantId: `bot-picture:${organizationId}`,
      nonce: session.user.id,
      origin: 'workspace',
      expiresAt: 0,
    },
    'picture',
    3,
  )
  return c.json(
    await createBotPicture(organizationId, assistantId, c.req.valid('json')),
  )
})

botPictureRoutes.delete(path, async (c) => {
  const { organizationId, assistantId } = c.req.param()
  await requirePermission(
    c.req.raw.headers,
    organizationId,
    'assistant',
    'update',
  )
  return c.json(await removeBotPicture(organizationId, assistantId))
})

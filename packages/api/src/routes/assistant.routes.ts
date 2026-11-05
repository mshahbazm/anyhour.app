import { answerableKinds } from '../services/knowledge/sourceEligibility'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db'
import { assistant, knowledgeSource } from '../db/schema'
import { updateAssistantSchema } from '../schemas/assistant.schema'
import { requirePermission } from '../services/auth/authorize'
import { ownedAssistant } from '../services/auth/owned'
import { ApiError } from '../services/http/apiError'
import { validateJson } from '../services/http/validateJson'
import { ownedBy } from '../services/knowledge/owner'
import { workspaceAi } from '../services/assistants/workspaceAi'
import { listInstalls } from '../services/widget/installs'
import { forgetSiteSettings } from '../services/widget/site'
import { syncWebsiteChannels } from '../services/connections/website'
import { siteInsights } from '../services/insights/siteInsights'
import { insightsLimits } from '../config/tracking.config'
import { saveWhatsappQuestionSchema } from '../schemas/whatsappQuestion.schema'
import { knownWhatsappNumber } from '../services/whatsappQuestion/knownNumber'
import {
  appearanceKeepingWhatsapp,
  ownerAssistant,
  removeWhatsappQuestion,
  saveWhatsappQuestion,
} from '../services/whatsappQuestion/question'

export const assistantRoutes = new Hono()

// The workspace's AI (docs/focusedProduct.md, "One AI per business").
assistantRoutes.get('/:organizationId/assistant', async (c) => {
  const organizationId = c.req.param('organizationId')
  await requirePermission(
    c.req.raw.headers,
    organizationId,
    'assistant',
    'read',
  )
  return c.json(await ownerAssistant(await workspaceAi(organizationId)))
})

assistantRoutes.get('/:organizationId/assistants/:assistantId', async (c) => {
  const { organizationId, assistantId } = c.req.param()
  await requirePermission(
    c.req.raw.headers,
    organizationId,
    'assistant',
    'read',
  )
  return c.json(
    await ownerAssistant(await ownedAssistant(organizationId, assistantId)),
  )
})

assistantRoutes.patch(
  '/:organizationId/assistants/:assistantId',
  validateJson(updateAssistantSchema),
  async (c) => {
    const { organizationId, assistantId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'update',
    )
    const current = await ownedAssistant(organizationId, assistantId)
    const input = c.req.valid('json')
    // Checked when going live, and when a live bot's websites change; other
    // edits to a live bot (look, tracking…) don't re-run the publish checks.
    const publishing =
      input.status === 'published' && current.status !== 'published'
    if (publishing) {
      const ready = await db
        .select({ id: knowledgeSource.id })
        .from(knowledgeSource)
        .where(
          and(
            ownedBy(knowledgeSource, { organizationId }),
            eq(knowledgeSource.status, 'ready'),
            eq(knowledgeSource.isIncluded, true),
            inArray(knowledgeSource.kind, [...answerableKinds]),
          ),
        )
        .limit(1)
      if (!ready.length)
        throw new ApiError(
          409,
          'no_knowledge',
          'Index at least one source before publishing',
        )
    }
    if (
      (publishing ||
        (current.status === 'published' && input.allowedOrigins)) &&
      !(input.allowedOrigins ?? current.allowedOrigins).length
    )
      throw new ApiError(
        422,
        'origin_required',
        'Allow at least one website origin',
      )
    const allowedOrigins = input.allowedOrigins
      ? [...new Set(input.allowedOrigins)]
      : undefined
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(assistant)
        .set({
          ...input,
          // The WhatsApp question is only changed by its own routes.
          appearance: input.appearance
            ? appearanceKeepingWhatsapp(input.appearance)
            : undefined,
          allowedOrigins,
          nextRefreshAt: input.refreshIntervalHours
            ? new Date(Date.now() + input.refreshIntervalHours * 3_600_000)
            : input.refreshIntervalHours === null
              ? null
              : undefined,
        })
        .where(eq(assistant.id, assistantId))
        .returning()
      // Its allowed websites are the website channels it answers.
      if (allowedOrigins)
        await syncWebsiteChannels(
          tx,
          organizationId,
          assistantId,
          allowedOrigins,
        )
      return row
    })
    forgetSiteSettings(assistantId)
    return c.json(await ownerAssistant(updated))
  },
)

// The WhatsApp question (docs/whatsappQuestion.md): the number it shares
// (read from the WhatsApp channel or Your business), and saving or removing
// the question with its rule.
const whatsappQuestion =
  '/:organizationId/assistants/:assistantId/whatsapp-question'

assistantRoutes.get(`${whatsappQuestion}/number`, async (c) => {
  const { organizationId, assistantId } = c.req.param()
  await requirePermission(
    c.req.raw.headers,
    organizationId,
    'assistant',
    'read',
  )
  await ownedAssistant(organizationId, assistantId)
  return c.json(await knownWhatsappNumber(organizationId))
})

assistantRoutes.put(
  whatsappQuestion,
  validateJson(saveWhatsappQuestionSchema),
  async (c) => {
    const { organizationId, assistantId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'update',
    )
    return c.json(
      await saveWhatsappQuestion(
        organizationId,
        assistantId,
        c.req.valid('json'),
      ),
    )
  },
)

assistantRoutes.delete(whatsappQuestion, async (c) => {
  const { organizationId, assistantId } = c.req.param()
  await requirePermission(
    c.req.raw.headers,
    organizationId,
    'assistant',
    'update',
  )
  await removeWhatsappQuestion(organizationId, assistantId)
  return c.body(null, 204)
})

// Visits, chats and leads from the website over 7, 30 or 90 days.
assistantRoutes.get(
  '/:organizationId/assistants/:assistantId/insights',
  async (c) => {
    const { organizationId, assistantId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'read',
    )
    await ownedAssistant(organizationId, assistantId)
    const days = Number(c.req.query('days') ?? '30')
    if (!(insightsLimits.rangeDays as readonly number[]).includes(days))
      throw new ApiError(422, 'invalid_range', 'Choose 7, 30 or 90 days')
    return c.json(await siteInsights(assistantId, days))
  },
)

// Where the chat code has been seen loading, and whether it works there.
assistantRoutes.get(
  '/:organizationId/assistants/:assistantId/installs',
  async (c) => {
    const { organizationId, assistantId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'read',
    )
    await ownedAssistant(organizationId, assistantId)
    return c.json(await listInstalls(assistantId))
  },
)

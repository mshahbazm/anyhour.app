import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { knowledgeGap } from '../db/schema'
import { noteConflictsSchema } from '../schemas/assistant.schema'
import { requirePermission } from '../services/auth/authorize'
import { ownedAssistant } from '../services/auth/owned'
import { ApiError } from '../services/http/apiError'
import { validateJson } from '../services/http/validateJson'
import { findFactConflicts } from '../services/knowledge/corrections/factConflicts'
import { openKnowledgeGaps } from '../services/knowledge/gaps/knowledgeGaps'
import { searchKnowledge } from '../services/knowledge/retrieval'

// What the owner teaches and decides about the bot's knowledge: questions it
// couldn't answer, facts told in chat, and website changes that disagree.
// Sources, notes and settling website changes live in
// knowledgeSources.routes.ts, under Your business.
export const knowledgeRoutes = new Hono()

// Questions the bot can't answer yet: real visitor questions first.
knowledgeRoutes.get(
  '/:organizationId/assistants/:assistantId/gaps',
  async (c) => {
    const { organizationId, assistantId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'read',
    )
    await ownedAssistant(organizationId, assistantId)
    return c.json(await openKnowledgeGaps(assistantId))
  },
)

// The owner can set aside a question that doesn't matter to the business.
knowledgeRoutes.patch(
  '/:organizationId/assistants/:assistantId/gaps/:gapId',
  validateJson(z.object({ status: z.literal('dismissed') })),
  async (c) => {
    const { organizationId, assistantId, gapId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'update',
    )
    await ownedAssistant(organizationId, assistantId)
    const [updated] = await db
      .update(knowledgeGap)
      .set({ status: 'dismissed', resolvedAt: new Date() })
      .where(
        and(
          eq(knowledgeGap.id, gapId),
          eq(knowledgeGap.assistantId, assistantId),
        ),
      )
      .returning({ id: knowledgeGap.id })
    if (!updated) throw new ApiError(404, 'gap_missing', 'Question not found')
    return c.json(updated)
  },
)

// Pages that would tell visitors something different from a fact the owner is
// about to save, so the helper can ask before the bot and website diverge.
knowledgeRoutes.post(
  '/:organizationId/assistants/:assistantId/notes/conflicts',
  validateJson(noteConflictsSchema),
  async (c) => {
    const { organizationId, assistantId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'update',
    )
    await ownedAssistant(organizationId, assistantId)
    return c.json(
      await findFactConflicts({
        organizationId,
        assistantId,
        ...c.req.valid('json'),
      }),
    )
  },
)

// What the bot would find for a question, so the helper can compare a new
// fact with what the website already says before saving it.
knowledgeRoutes.get(
  '/:organizationId/assistants/:assistantId/knowledge/search',
  async (c) => {
    const { organizationId, assistantId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'read',
    )
    await ownedAssistant(organizationId, assistantId)
    const question = (c.req.query('q') ?? '').trim().slice(0, 500)
    if (!question)
      throw new ApiError(400, 'question_missing', 'Pass a question as q')
    const passages = await searchKnowledge(
      assistantId,
      organizationId,
      null,
      question,
    )
    return c.json(
      passages
        .filter((item) => item.kind === 'content')
        .map((item) => ({
          sourceId: item.sourceId,
          title: item.title,
          url: item.url,
          origin: item.origin,
          text: item.text,
        })),
    )
  },
)

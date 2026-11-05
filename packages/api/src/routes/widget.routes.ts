import { visitorCitations } from '../services/chat/citations'
import { createHash, randomBytes } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { getConnInfo } from 'hono/bun'
import { visitorGreeting } from '../services/chat/greeting'
import { readStoredPicture } from '../services/assistants/botPicture'
import { db } from '../db'
import { conversation, message } from '../db/schema'
import {
  createConversationSchema,
  sendMessageSchema,
} from '../schemas/widget.schema'
import { createAnswerStream } from '../services/chat/answer'
import { beginReply, failReply } from '../services/chat/messages'
import { ApiError } from '../services/http/apiError'
import { validateJson } from '../services/http/validateJson'
import { captureChatLead } from '../services/leads/capture'
import { visitorTurn } from '../services/chat/blocks'
import {
  staffFirstNames,
  visitorUpdates,
} from '../services/support/conversations'
import { whatsappOpenSchema } from '../schemas/whatsappQuestion.schema'
import { publicAppearance } from '../services/whatsappQuestion/question'
import {
  noteWhatsappAsk,
  noteWhatsappOpen,
} from '../services/whatsappQuestion/tracking'
import { recordInstallSighting } from '../services/widget/installs'
import { allowedSite } from '../services/widget/site'
import {
  getPublishedAssistant,
  issueEmbedToken,
  limitPublicRequest,
  mayLoadOn,
  verifyEmbedToken,
} from '../services/widget/access'
import { widgetAssistantId } from '../services/connections/website'
import { insightsLimits } from '../config/tracking.config'
import { collect, countedTracking } from '../services/insights/collect'
import type { iBeacon } from '../services/insights/collect'

// `:assistantId` is the install code's id: the AI (`data-bot`) or a website
// channel (`data-site`), resolved to the AI that answers it.
export const widgetRoutes = new Hono()

const bot = (c: { req: { param: (name: 'assistantId') => string } }) =>
  widgetAssistantId(c.req.param('assistantId'))

// What the visitor sees while a team member handles the conversation.
export const teamWillReply = 'The team will reply here.'

async function access(
  c: { req: { header: (name: string) => string | undefined } },
  assistantId: string,
  action: string,
  limit: number,
  sharedLimit?: number,
) {
  const token = verifyEmbedToken(c.req.header('authorization'), assistantId)
  const origin = c.req.header('origin')
  const record = await getPublishedAssistant(assistantId)
  if (!origin || origin !== token.origin || !(await mayLoadOn(record, origin)))
    throw new ApiError(403, 'origin_forbidden', 'This website is not allowed')
  await limitPublicRequest(token, action, limit, sharedLimit)
  return token
}

async function ownedConversation(
  assistantId: string,
  conversationId: string,
  resumeToken: string | undefined,
) {
  if (!resumeToken)
    throw new ApiError(
      401,
      'resume_token_required',
      'Conversation token required',
    )
  const hash = createHash('sha256').update(resumeToken).digest('hex')
  const [record] = await db
    .select()
    .from(conversation)
    .where(
      and(
        eq(conversation.id, conversationId),
        eq(conversation.assistantId, assistantId),
        eq(conversation.resumeTokenHash, hash),
      ),
    )
    .limit(1)
  if (!record)
    throw new ApiError(
      403,
      'conversation_forbidden',
      'Conversation access denied',
    )
  return record
}

widgetRoutes.post('/:assistantId/bootstrap', async (c) => {
  const origin = c.req.header('origin')
  if (!origin || origin === 'null')
    throw new ApiError(403, 'origin_required', 'Website origin required')
  const assistantId = await bot(c)
  await limitPublicRequest(
    {
      assistantId,
      origin,
      expiresAt: 0,
      nonce: origin,
    },
    'bootstrap',
    120,
  )
  // Each page load is a heartbeat: it tells the owner where the code is and
  // whether the chat can start there.
  try {
    const token = await issueEmbedToken(assistantId, origin)
    await recordInstallSighting(assistantId, origin, 'working').catch(
      () => undefined,
    )
    return c.json({ token, expiresInSeconds: 3600 })
  } catch (error) {
    await recordInstallSighting(assistantId, origin, 'rejected').catch(
      () => undefined,
    )
    throw error
  }
})

// What the closed chat needs, fetched by the embed loader once the website
// has finished loading. Public data, so no token; browsers keep it for a few
// minutes. Each fetch is also the install heartbeat.
widgetRoutes.get('/:assistantId/launcher', async (c) => {
  const assistantId = await bot(c)
  const origin = c.req.header('origin')
  if (!origin || origin === 'null')
    throw new ApiError(403, 'origin_required', 'Website origin required')
  if (!(await allowedSite(assistantId, origin))) {
    await recordInstallSighting(assistantId, origin, 'rejected').catch(
      () => undefined,
    )
    throw new ApiError(403, 'origin_forbidden', 'This website is not allowed')
  }
  await recordInstallSighting(assistantId, origin, 'working').catch(
    () => undefined,
  )
  const record = await getPublishedAssistant(assistantId)
  c.header('cache-control', 'private, max-age=300')
  return c.json({
    id: record.id,
    name: record.name,
    welcomeMessage: visitorGreeting(record),
    appearance: publicAppearance(record.appearance),
    pictureUrl: record.pictureKey
      ? `/api/widget/${record.id}/picture?v=${encodeURIComponent(record.pictureKey)}`
      : null,
    tracking: countedTracking(record),
  })
})

// The visitor's address, only ever hashed: from the proxy in front of the
// API when there is one, else the connection.
function clientIp(c: Context) {
  const forwarded =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  try {
    return getConnInfo(c).remote.address ?? ''
  } catch {
    return ''
  }
}

// Insights beacon from the embed loader (sent as text, so no preflight).
// Always answers 204 at once; ignored unless the owner turned visitor
// counts on, and only what they chose is counted. What it counts is decided
// in memory.
widgetRoutes.post('/:assistantId/collect', async (c) => {
  const assistantId = await bot(c)
  const site = await allowedSite(assistantId, c.req.header('origin'))
  const declared = Number(c.req.header('content-length') ?? 0)
  const tracking = site ? countedTracking(site) : null
  if (
    !tracking ||
    !Object.values(tracking).some(Boolean) ||
    declared > insightsLimits.beaconBytes
  )
    return c.body(null, 204)
  const text = await c.req.text()
  if (text.length > insightsLimits.beaconBytes) return c.body(null, 204)
  let beacon: iBeacon
  try {
    beacon = JSON.parse(text) as iBeacon
  } catch {
    return c.body(null, 204)
  }
  if (!Array.isArray(beacon.e)) return c.body(null, 204)
  collect({
    assistantId,
    tracking,
    beacon: {
      tz: typeof beacon.tz === 'string' ? beacon.tz : undefined,
      w: typeof beacon.w === 'number' ? beacon.w : undefined,
      e: beacon.e.filter(
        (event): event is iBeacon['e'][number] =>
          typeof event === 'object' && event !== null,
      ),
    },
    ip: clientIp(c),
    userAgent: c.req.header('user-agent') ?? '',
    countryHeader:
      c.req.header('cf-ipcountry') ?? c.req.header('x-vercel-ip-country'),
  })
  return c.body(null, 204)
})

widgetRoutes.get('/:assistantId/config', async (c) => {
  const assistantId = await bot(c)
  await access(c, assistantId, 'config', 120)
  const record = await getPublishedAssistant(assistantId)
  return c.json({
    id: record.id,
    name: record.name,
    welcomeMessage: visitorGreeting(record),
    appearance: publicAppearance(record.appearance),
    pictureUrl: record.pictureKey
      ? `/api/widget/${record.id}/picture?v=${encodeURIComponent(record.pictureKey)}`
      : null,
  })
})

// Public so the launcher <img> can load it; only published bots have one here.
widgetRoutes.get('/:assistantId/picture', async (c) => {
  const record = await getPublishedAssistant(await bot(c))
  const picture = await readStoredPicture(record.pictureKey)
  return c.body(new Uint8Array(picture.body), 200, {
    'content-type': picture.contentType,
    'cache-control': 'public, max-age=86400',
  })
})

widgetRoutes.post(
  '/:assistantId/conversations',
  validateJson(createConversationSchema),
  async (c) => {
    const assistantId = await bot(c)
    await access(c, assistantId, 'conversation', 20)
    const resumeToken = randomBytes(32).toString('base64url')
    const [record] = await db
      .insert(conversation)
      .values({
        assistantId,
        resumeTokenHash: createHash('sha256').update(resumeToken).digest('hex'),
        ...c.req.valid('json'),
      })
      .returning()
    return c.json(
      { id: record.id, resumeToken, createdAt: record.createdAt },
      201,
    )
  },
)

widgetRoutes.get('/:assistantId/conversations/:conversationId', async (c) => {
  const { conversationId } = c.req.param()
  const assistantId = await bot(c)
  await access(c, assistantId, 'history', 120)
  const record = await ownedConversation(
    assistantId,
    conversationId,
    c.req.header('x-conversation-token'),
  )
  const history = await db
    .select()
    .from(message)
    .where(eq(message.conversationId, record.id))
    .orderBy(asc(message.createdAt))
  const staffNames = await staffFirstNames(record.id)
  // Never owner-only fields (handoff summary, draft, notes): the visitor
  // sees the messages, a team member's first name and who is replying.
  return c.json({
    id: record.id,
    status: record.status,
    handledBy: record.handledBy,
    waitingForTeam: Boolean(record.needsHumanSince),
    messages: history.map(
      ({ id, role, content, status, citations, blocks, createdAt }) => ({
        id,
        role,
        content,
        status,
        citations: visitorCitations(citations),
        blocks,
        createdAt,
        ...(role === 'staff'
          ? { staffName: staffNames.get(id) ?? 'The team' }
          : {}),
      }),
    ),
  })
})

// The open chat polls this for team replies: staff messages after `after`
// (an ISO time) and whether the team is handling the conversation.
widgetRoutes.get(
  '/:assistantId/conversations/:conversationId/updates',
  async (c) => {
    const { conversationId } = c.req.param()
    const assistantId = await bot(c)
    await access(c, assistantId, 'updates', 40, 20_000)
    const record = await ownedConversation(
      assistantId,
      conversationId,
      c.req.header('x-conversation-token'),
    )
    const after = c.req.query('after')
    const since = after ? new Date(after) : null
    if (since && Number.isNaN(since.getTime()))
      throw new ApiError(422, 'invalid_after', 'after must be an ISO time')
    return c.json(await visitorUpdates(record.id, since))
  },
)

// The visitor opened the WhatsApp button (docs/whatsappQuestion.md). Sent
// as the link opens, so it never holds up the visitor.
widgetRoutes.post(
  '/:assistantId/conversations/:conversationId/whatsapp-open',
  validateJson(whatsappOpenSchema),
  async (c) => {
    const { conversationId } = c.req.param()
    const assistantId = await bot(c)
    await access(c, assistantId, 'whatsappOpen', 20)
    const chat = await ownedConversation(
      assistantId,
      conversationId,
      c.req.header('x-conversation-token'),
    )
    await noteWhatsappOpen(chat, c.req.valid('json').blockId)
    return c.body(null, 204)
  },
)

widgetRoutes.post(
  '/:assistantId/conversations/:conversationId/messages',
  validateJson(sendMessageSchema),
  async (c) => {
    const { conversationId } = c.req.param()
    const assistantId = await bot(c)
    await access(c, assistantId, 'message', 60)
    const chat = await ownedConversation(
      assistantId,
      conversationId,
      c.req.header('x-conversation-token'),
    )
    const sent = c.req.valid('json')
    const turn = await visitorTurn(chat.id, sent)
    const input = { ...sent, ...turn }
    const reply = await beginReply(chat.id, input)
    // Asking for WhatsApp is recorded, never at the cost of the answer.
    await noteWhatsappAsk(chat, input.content).catch((error) =>
      console.error(
        'WhatsApp ask not recorded',
        error instanceof Error ? error.name : 'Unknown error',
      ),
    )
    // The contact form records the lead through the same capture as the
    // AI's capture_lead, keyed to this turn, so the AI
    // recording it too finds the same lead.
    if (turn.contact)
      await captureChatLead(
        assistantId,
        chat.id,
        sent.clientMessageId,
        {
          reason: 'enquiry',
          title: turn.contact.topic,
          name: turn.contact.name,
          email: turn.contact.email,
          phone: turn.contact.phone,
        },
        AbortSignal.timeout(30_000),
      ).catch((error) => {
        // Their message and the AI's answer still go ahead.
        console.error(
          'Contact form lead not recorded',
          error instanceof ApiError ? error.code : 'Unknown error',
        )
      })
    // A team member has this conversation: the AI stays quiet and
    // the visitor's message waits for them in Needs you.
    if (reply.handledBy === 'human')
      return new Response(
        [
          `event: team\ndata: ${JSON.stringify({ message: teamWillReply })}\n\n`,
          `event: done\ndata: ${JSON.stringify({ messageId: null, handledBy: 'human' })}\n\n`,
        ].join(''),
        {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
          },
        },
      )
    let stream: ReadableStream<Uint8Array>
    try {
      stream = await createAnswerStream(
        assistantId,
        chat.id,
        input.clientMessageId,
        reply,
      )
    } catch (error) {
      await failReply(reply, 'agent_failed')
      throw error
    }
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
      },
    })
  },
)

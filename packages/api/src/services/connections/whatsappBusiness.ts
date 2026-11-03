import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import { connection } from '../../db/schema'
import { env } from '../../env'
import {
  receiveCustomerMessage,
  receiveDeliveryStatus,
} from '../customerWhatsapp/inbound'
import {
  whatsappBusinessActions,
  whatsappBusinessToken,
} from './whatsappBusinessApi'
import type { iConnectionProvider, iProviderEvent } from './types'

// Customers on the business's own WhatsApp number (WhatsApp Business Cloud
// API, docs/customerWhatsapp.md). Not a team chat app: the owner pastes the
// number's ids and a system user token on Channels, and every message is a
// customer talking to the AI. Meta posts to
// /api/connect/whatsapp_business/webhook, signed with our app secret.

// X-Hub-Signature-256: sha256=HMAC-SHA256(app secret, raw body).
function verifyMeta(headers: Headers, rawBody: string) {
  const secret = env.WHATSAPP_APP_SECRET
  const signature = headers.get('x-hub-signature-256')
  if (!secret || !signature) return false
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
  )
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export interface iWhatsappInbound {
  id: string
  from: string
  timestamp?: string
  type: string
  text?: { body?: string }
  button?: { text?: string }
  interactive?: {
    // The id is the one we gave the button or row (customerWhatsapp/blocks.ts).
    button_reply?: { id?: string; title?: string }
    list_reply?: { id?: string; title?: string }
  }
  image?: { caption?: string }
  video?: { caption?: string }
  document?: { caption?: string; filename?: string }
}

export interface iWhatsappStatus {
  id: string
  status: string
  recipient_id: string
  errors?: Array<{ code?: number; title?: string }>
}

interface iWebhookBody {
  object?: string
  entry?: Array<{
    changes?: Array<{
      field?: string
      value?: {
        metadata?: { phone_number_id?: string }
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
        messages?: iWhatsappInbound[]
        statuses?: iWhatsappStatus[]
      }
    }>
  }>
}

const ok = () => new Response(null, { status: 200 })

function parseMeta(_headers: Headers, rawBody: string) {
  const body = JSON.parse(rawBody) as iWebhookBody
  const events: iProviderEvent[] = []
  if (body.object !== 'whatsapp_business_account') return { events, ack: ok() }
  for (const entry of body.entry ?? [])
    for (const change of entry.changes ?? []) {
      const value = change.value
      const numberId = value?.metadata?.phone_number_id
      if (change.field !== 'messages' || !value || !numberId) continue
      for (const item of value.messages ?? []) {
        if (!item.id || !item.from || item.type === 'reaction') continue
        const name = value.contacts?.find(
          (person) => person.wa_id === item.from,
        )?.profile?.name
        events.push({
          externalAccountId: numberId,
          externalEventId: item.id,
          kind: 'message',
          // One customer's events run one at a time (the job's key).
          externalUserId: item.from,
          payload: { message: item, profileName: name ?? null },
        })
      }
      for (const item of value.statuses ?? []) {
        if (!item.id || !item.status) continue
        events.push({
          externalAccountId: numberId,
          externalEventId: `status:${item.id}:${item.status}`,
          kind: 'status',
          externalUserId: item.recipient_id ?? null,
          payload: { status: item },
        })
      }
    }
  return { events, ack: ok() }
}

export const whatsappBusinessProvider: iConnectionProvider = {
  id: 'whatsapp_business',
  available: () =>
    Boolean(env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN),
  // Meta checks the callback URL once with our verify token.
  challenge(query) {
    if (
      query.get('hub.mode') === 'subscribe' &&
      env.WHATSAPP_VERIFY_TOKEN &&
      query.get('hub.verify_token') === env.WHATSAPP_VERIFY_TOKEN
    )
      return new Response(query.get('hub.challenge') ?? '', { status: 200 })
    return new Response('Forbidden', { status: 403 })
  },
  verifyWebhook: verifyMeta,
  parseWebhook: parseMeta,
  async handleEvent(record, event) {
    if (event.kind === 'message')
      await receiveCustomerMessage(
        record,
        event.payload.message as iWhatsappInbound,
        (event.payload.profileName as string | null) ?? null,
      )
    else if (event.kind === 'status')
      await receiveDeliveryStatus(
        record,
        event.payload.status as iWhatsappStatus,
      )
  },
  // Our app leaves the account, unless another connected number is in it.
  async disconnect(record) {
    const account = record.settings.businessAccountId
    if (!account) return
    const others = await db
      .select({ id: connection.id })
      .from(connection)
      .where(
        and(
          eq(connection.provider, 'whatsapp_business'),
          ne(connection.id, record.id),
          sql`${connection.settings}->>'businessAccountId' = ${account}`,
        ),
      )
    if (!others.length)
      await whatsappBusinessActions.unsubscribe(
        account,
        whatsappBusinessToken(record),
      )
  },
}

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { assistant, publicRateLimit } from '../../db/schema'
import { env } from '../../env'
import { ApiError } from '../http/apiError'
import { answersWebsite } from '../connections/website'

type tToken = {
  assistantId: string
  origin: string
  expiresAt: number
  nonce: string
}

export async function getPublishedAssistant(assistantId: string) {
  const [record] = await db
    .select()
    .from(assistant)
    .where(
      and(eq(assistant.id, assistantId), eq(assistant.status, 'published')),
    )
    .limit(1)
  if (!record)
    throw new ApiError(404, 'assistant_missing', 'Assistant not found')
  return record
}

// The member's website channels, or the older allowed list kept alongside.
export async function mayLoadOn(
  record: { id: string; allowedOrigins: string[] },
  origin: string,
) {
  return (
    record.allowedOrigins.includes(origin) ||
    (await answersWebsite(record.id, origin))
  )
}

export async function issueEmbedToken(assistantId: string, origin: string) {
  const record = await getPublishedAssistant(assistantId)
  if (!(await mayLoadOn(record, origin)))
    throw new ApiError(403, 'origin_forbidden', 'This website is not allowed')
  const payload: tToken = {
    assistantId,
    origin,
    expiresAt: Date.now() + 60 * 60 * 1000,
    nonce: randomBytes(16).toString('hex'),
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(encoded)
    .digest('base64url')
  return `${encoded}.${signature}`
}

export function verifyEmbedToken(
  value: string | undefined,
  assistantId: string,
) {
  if (!value?.startsWith('Bearer '))
    throw new ApiError(401, 'embed_token_required', 'Embed token required')
  const [encoded, signature] = value.slice(7).split('.')
  if (!encoded || !signature)
    throw new ApiError(401, 'invalid_embed_token', 'Invalid embed token')
  const expected = createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(encoded)
    .digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new ApiError(401, 'invalid_embed_token', 'Invalid embed token')
  let token: tToken
  try {
    token = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as tToken
  } catch {
    throw new ApiError(401, 'invalid_embed_token', 'Invalid embed token')
  }
  if (token.assistantId !== assistantId || token.expiresAt < Date.now())
    throw new ApiError(401, 'expired_embed_token', 'Embed token expired')
  return token
}

// maxPerMinute is per visitor; a site and a bot get ten times that unless
// sharedPerMinute says otherwise (a light poll every open chat makes).
export async function limitPublicRequest(
  token: tToken,
  action: string,
  maxPerMinute: number,
  sharedPerMinute = maxPerMinute * 10,
) {
  const bucketStart = new Date(Math.floor(Date.now() / 60_000) * 60_000)
  await incrementRateBucket(
    `${token.assistantId}:${token.nonce}:${action}`,
    bucketStart,
    maxPerMinute,
  )
  if (action !== 'bootstrap') {
    await incrementRateBucket(
      `${token.assistantId}:${token.origin}:${action}:site`,
      bucketStart,
      sharedPerMinute,
    )
  }
  await incrementRateBucket(
    `${token.assistantId}:${action}:assistant`,
    bucketStart,
    sharedPerMinute,
  )
}

async function incrementRateBucket(
  key: string,
  bucketStart: Date,
  maxPerMinute: number,
) {
  const keyHash = createHash('sha256').update(key).digest('hex')
  const [row] = await db
    .insert(publicRateLimit)
    .values({
      keyHash,
      bucketStart,
      requestCount: 1,
      expiresAt: new Date(bucketStart.getTime() + 3_600_000),
    })
    .onConflictDoUpdate({
      target: [publicRateLimit.keyHash, publicRateLimit.bucketStart],
      set: { requestCount: sql`${publicRateLimit.requestCount} + 1` },
    })
    .returning({ requestCount: publicRateLimit.requestCount })
  if (row.requestCount > maxPerMinute)
    throw new ApiError(429, 'rate_limited', 'Too many requests')
}

import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { env } from '../src/env'

const accountSchema = z.object({
  email: z.email(),
  userId: z.string().min(1),
  cookie: z.string().min(1),
})

const credentialsSchema = z.object({
  version: z.literal(1),
  apiOrigin: z.url(),
  organizationId: z.string().min(1),
  accounts: z.object({
    owner: accountSchema,
    admin: accountSchema,
    member: accountSchema,
    outsider: accountSchema,
  }),
})

export type tTestCredentials = z.infer<typeof credentialsSchema>
export type tTestRole = keyof tTestCredentials['accounts']
export type tSeedScope = 'manual' | 'integration'

export function credentialsPath(scope: tSeedScope) {
  const filename =
    scope === 'integration'
      ? 'integration-credentials.json'
      : 'credentials.json'
  return new URL(`../.local-test/${filename}`, import.meta.url)
}

export function assertLocalTestEnvironment() {
  const databaseHost = new URL(env.DATABASE_URL).hostname
  const apiUrl = new URL(env.BETTER_AUTH_URL)
  const loopback = ['localhost', '127.0.0.1', '::1']

  if (
    process.env.NODE_ENV === 'production' ||
    !loopback.includes(databaseHost) ||
    !loopback.includes(apiUrl.hostname) ||
    apiUrl.port !== String(env.PORT)
  ) {
    throw new Error(
      'Test users require the local API port and local PostgreSQL',
    )
  }
}

export async function loadTestCredentials(scope: tSeedScope) {
  const credentials = credentialsSchema.parse(
    JSON.parse(await readFile(credentialsPath(scope), 'utf8')),
  )
  if (credentials.apiOrigin !== env.BETTER_AUTH_URL) {
    throw new Error('The local API origin changed; rerun the test user seed')
  }
  return credentials
}

export async function requestAs(
  credentials: tTestCredentials,
  role: tTestRole,
  path: string,
  body?: object,
) {
  return fetch(`${credentials.apiOrigin}/api/auth${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Cookie: credentials.accounts[role].cookie,
      ...(body
        ? { 'Content-Type': 'application/json', Origin: env.FRONT_END_URL }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
}

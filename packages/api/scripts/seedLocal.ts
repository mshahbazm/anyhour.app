import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import {
  organization as organizationPlugin,
  testUtils,
} from 'better-auth/plugins'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { ac, roles } from '../src/config/permissions.config'
import { db } from '../src/db'
import * as schema from '../src/db/schema'
import { env } from '../src/env'
import { clearLeftoverIntegrationWork } from './integrationReset'
import { assertLocalTestEnvironment, credentialsPath } from './localSeedSupport'
import type { tTestCredentials } from './localSeedSupport'

assertLocalTestEnvironment()
const scope = process.argv.includes('--integration') ? 'integration' : 'manual'
const accountPrefix = scope === 'integration' ? 'integration' : 'dev'

// Better Auth's privileged helpers stay in this local-only script, never in the API.
const testAuth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  plugins: [organizationPlugin({ ac, roles }), testUtils()],
})

const helpers = (await testAuth.$context).test
const { createOrganization, saveOrganization, addMember } = helpers
if (!createOrganization || !saveOrganization || !addMember) {
  throw new Error('Better Auth organization test helpers are unavailable')
}

async function ensureUser(email: string, name: string) {
  const existing = await db.query.user.findFirst({
    where: eq(schema.user.email, email),
  })

  if (existing) {
    if (!existing.emailVerified || existing.name !== name) {
      await db
        .update(schema.user)
        .set({ emailVerified: true, name })
        .where(eq(schema.user.id, existing.id))
    }
    return existing
  }

  return helpers.saveUser(
    helpers.createUser({ email, name, emailVerified: true }),
  )
}

const users = {
  owner: await ensureUser(`${accountPrefix}-test@anyhour.local`, 'Test Owner'),
  admin: await ensureUser(`${accountPrefix}-admin@anyhour.local`, 'Test Admin'),
  member: await ensureUser(
    `${accountPrefix}-member@anyhour.local`,
    'Test Member',
  ),
  outsider: await ensureUser(
    `${accountPrefix}-outsider@anyhour.local`,
    'Test Outsider',
  ),
}

const slug =
  scope === 'integration' ? 'anyhour-integration-test' : 'anyhour-local-test'
const existingOrganization = await db.query.organization.findFirst({
  where: eq(schema.organization.slug, slug),
})
const organization =
  existingOrganization ??
  (await saveOrganization(
    createOrganization({
      name: 'Anyhour Test Workspace',
      slug,
    }),
  ))

if (typeof organization.id !== 'string') {
  throw new Error('Test organization has no ID')
}
const organizationId = organization.id

async function ensureMembership(
  userId: string,
  role: 'owner' | 'admin' | 'member',
  createMember: NonNullable<typeof helpers.addMember>,
) {
  const existing = await db.query.member.findFirst({
    where: and(
      eq(schema.member.userId, userId),
      eq(schema.member.organizationId, organizationId),
    ),
  })

  if (existing) {
    if (existing.role !== role) {
      await db
        .update(schema.member)
        .set({ role })
        .where(eq(schema.member.id, existing.id))
    }
    return
  }

  await createMember({ userId, organizationId, role })
}

await ensureMembership(users.owner.id, 'owner', addMember)
await ensureMembership(users.admin.id, 'admin', addMember)
await ensureMembership(users.member.id, 'member', addMember)
await db
  .delete(schema.member)
  .where(
    and(
      eq(schema.member.userId, users.outsider.id),
      eq(schema.member.organizationId, organizationId),
    ),
  )

const userIds = Object.values(users).map((user) => user.id)
// Each integration test and the browser fixture make their own workspace after
// this seed. Leaving the workspaces of earlier runs keeps the test users in
// this one and the current run's only; Better Auth lists at most 100.
if (scope === 'integration')
  await db
    .delete(schema.member)
    .where(
      and(
        inArray(schema.member.userId, userIds),
        ne(schema.member.organizationId, organizationId),
      ),
    )
await db.delete(schema.session).where(inArray(schema.session.userId, userIds))
// Each integration file starts with no work left by the ones before it.
if (scope === 'integration') await clearLeftoverIntegrationWork()

async function createCredential(
  user: (typeof users)['owner'],
  activeOrganizationId?: string,
) {
  const login = await helpers.login({
    userId: user.id,
    ...(activeOrganizationId ? { session: { activeOrganizationId } } : {}),
  })
  const cookie = login.headers.get('cookie')
  if (!cookie) throw new Error('Better Auth did not create a test cookie')

  return { email: user.email, userId: user.id, cookie }
}

const credentials = {
  version: 1,
  apiOrigin: env.BETTER_AUTH_URL,
  organizationId,
  accounts: {
    owner: await createCredential(users.owner, organizationId),
    admin: await createCredential(users.admin, organizationId),
    member: await createCredential(users.member, organizationId),
    outsider: await createCredential(users.outsider),
  },
} satisfies tTestCredentials

const credentialsDirectory = new URL('../.local-test/', import.meta.url)
const temporaryPath = new URL(
  `credentials.${process.pid}.tmp`,
  credentialsDirectory,
)
await mkdir(credentialsDirectory, { recursive: true, mode: 0o700 })
await chmod(credentialsDirectory, 0o700)
await writeFile(temporaryPath, JSON.stringify(credentials, null, 2), {
  mode: 0o600,
})
await rename(temporaryPath, credentialsPath(scope))
await chmod(credentialsPath(scope), 0o600)

console.info(`Four ${scope} local users seeded; cookies saved in .local-test/`)

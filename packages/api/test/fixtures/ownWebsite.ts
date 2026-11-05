import type { tTestCredentials } from '../../scripts/localSeedSupport'

// Knowledge belongs to the workspace (Your business), so a test that reads a
// website into the shared seeded workspace would see every earlier run's
// pages. Crawl tests get a workspace of their own instead: the seeded owner,
// admin and member, and its one AI, as sign-up leaves it.
export async function createTestWorkspace(
  credentials: tTestCredentials,
  name: string,
) {
  const { db } = await import('../../src/db')
  const { assistant, member, organization } =
    await import('../../src/db/schema')
  const organizationId = crypto.randomUUID()
  await db
    .insert(organization)
    .values({ id: organizationId, name, slug: organizationId })
  await db.insert(member).values(
    (['owner', 'admin', 'member'] as const).map((role) => ({
      id: crypto.randomUUID(),
      userId: credentials.accounts[role].userId,
      organizationId,
      role,
    })),
  )
  const [ai] = await db
    .insert(assistant)
    .values({ organizationId, name })
    .returning({ id: assistant.id })
  return { organizationId, assistantId: ai.id }
}

// Adds a website to Your business. `post` sends to the workspace's
// `/business` routes; the result is the created source and its first run.
export async function addWebsite(
  post: (path: string, body: object) => Promise<Response>,
  input: { websiteUrl: string; excludePaths?: string[] },
) {
  const added = await post('/business/sources', {
    kind: 'website',
    url: input.websiteUrl,
    ...(input.excludePaths ? { excludePaths: input.excludePaths } : {}),
  })
  if (added.status !== 201)
    throw new Error(
      `Adding the website failed: ${added.status} ${await added.text()}`,
    )
  return (await added.json()) as {
    source: { id: string }
    indexRun: { id: string }
  }
}

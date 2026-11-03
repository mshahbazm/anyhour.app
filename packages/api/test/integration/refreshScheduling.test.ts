import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { eq } from 'drizzle-orm'

// Supplemental service test: source/run authorization is covered over HTTP in
// sourceOperations.test.ts; this isolates the scheduling transaction and send.
test('refresh scheduling commits all run requests with its deadline and survives failed dispatch', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Refresh scheduling test requires local PostgreSQL')
  process.env.NODE_ENV = 'test'
  process.env.FRONT_END_URL ??= 'http://localhost:3000'
  const { db } = await import('../../src/db')
  const { assistant, indexRun, knowledgeSource, organization } =
    await import('../../src/db/schema')
  const { refreshAssistantIfDue } =
    await import('../../src/services/knowledge/refreshScheduling')
  const { getBoss } = await import('../../src/services/queue/boss')
  const boss = await getBoss()
  const send = boss.send
  let dispatchAttempts = 0
  boss.send = (async () => {
    dispatchAttempts++
    throw new Error('Simulated queue outage after scheduling commit')
  }) as typeof boss.send
  const organizationId = crypto.randomUUID()
  const assistantId = crypto.randomUUID()
  const now = new Date()
  await db.insert(organization).values({
    id: organizationId,
    name: 'Refresh scheduling',
    slug: `refresh-${organizationId}`,
  })
  try {
    await db.insert(assistant).values({
      id: assistantId,
      organizationId,
      name: 'Refresh durability regression',
      status: 'published',
      refreshIntervalHours: 6,
      nextRefreshAt: new Date(now.getTime() - 60_000),
    })
    const [website] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(assistantId),
        kind: 'website',
        inputUrl: 'https://scheduled-root.example/',
      })
      .returning()
    const [document] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(assistantId),
        kind: 'publicDocument',
        canonicalUrl: 'https://scheduled-document.example/guide.pdf',
        inputUrl: 'https://scheduled-document.example/guide.pdf',
      })
      .returning()
    await db.insert(knowledgeSource).values([
      {
        organizationId: orgOf(assistantId),
        kind: 'upload',
        cleanedText: 'No automatic upload refresh.',
      },
      {
        organizationId: orgOf(assistantId),
        kind: 'webPage',
        isIncluded: false,
        canonicalUrl: 'https://excluded-refresh.example/',
      },
      {
        organizationId: orgOf(assistantId),
        kind: 'webPage',
        parentId: website.id,
        canonicalUrl: 'https://scheduled-root.example/child',
      },
    ])
    const [existing] = await db
      .insert(indexRun)
      .values({
        organizationId: orgOf(assistantId),
        targetSourceId: document.id,
        trigger: 'manual',
      })
      .returning()

    // Competing schedulers must create one website request and reuse the active
    // document request. Queue delivery deliberately fails after the commit.
    const scheduled = await Promise.all([
      refreshAssistantIfDue(assistantId, now),
      refreshAssistantIfDue(assistantId, now),
    ])
    assert.deepEqual(scheduled.map((runs) => runs.length).sort(), [0, 2])
    const runs = await db
      .select()
      .from(indexRun)
      .where(eq(indexRun.organizationId, orgOf(assistantId)))
    assert.equal(runs.length, 2)
    assert.ok(runs.every((run) => run.status === 'queued'))
    assert.equal(
      runs.find((run) => run.targetSourceId === document.id)?.id,
      existing.id,
    )
    assert.equal(
      runs.find((run) => run.targetSourceId === website.id)?.trigger,
      'scheduled',
    )
    const [owner] = await db
      .select()
      .from(assistant)
      .where(eq(assistant.id, assistantId))
    assert.equal(owner.nextRefreshAt?.getTime(), now.getTime() + 6 * 3_600_000)
    assert.equal(dispatchAttempts, 2)
    assert.deepEqual(await refreshAssistantIfDue(assistantId, now), [])
    assert.equal(dispatchAttempts, 2)
    assert.equal(
      (
        await db
          .select()
          .from(indexRun)
          .where(eq(indexRun.organizationId, orgOf(assistantId)))
      ).length,
      2,
    )
  } finally {
    boss.send = send
    await db
      .delete(indexRun)
      .where(eq(indexRun.organizationId, orgOf(assistantId)))
    await db
      .update(knowledgeSource)
      .set({ parentId: null })
      .where(eq(knowledgeSource.organizationId, orgOf(assistantId)))
    await db
      .delete(knowledgeSource)
      .where(eq(knowledgeSource.organizationId, orgOf(assistantId)))
    await db.delete(assistant).where(eq(assistant.id, assistantId))
    await db.delete(organization).where(eq(organization.id, organizationId))
    await boss.stop()
  }
}, 60_000)

import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { and, eq, inArray, isNull } from 'drizzle-orm'

test('source operations preserve pinned evidence, recover upload cleanup, and serialize creation and run requests', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Source operations test requires local PostgreSQL')
  let failDeletes = true
  let deletionAttempts = 0
  const objects = new Set<string>()
  const fixture = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (request.method !== 'DELETE')
        return new Response(null, { status: 404 })
      deletionAttempts++
      if (failDeletes)
        return new Response('Temporary storage outage', { status: 503 })
      objects.delete(new URL(request.url).pathname)
      return new Response(null, { status: 204 })
    },
  })
  let handle: (request: Request) => Response | Promise<Response> = () =>
    new Response(null, { status: 503 })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => handle(request),
  })
  const origin = `http://127.0.0.1:${server.port}`
  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: String(server.port),
    BETTER_AUTH_URL: origin,
    FRONT_END_URL: 'http://localhost:3000',
    LLM_KEY: 'fixture-key',
    R2_ENDPOINT: `http://127.0.0.1:${fixture.port}`,
    R2_BUCKET: 'uploads',
    R2_ACCESS_KEY_ID: 'fixture',
    R2_SECRET_ACCESS_KEY: 'fixture',
  })
  const { app } = await import('../../src/app')
  handle = (request) => app.fetch(request)
  const { db } = await import('../../src/db')
  const {
    assistant,
    indexRun,
    knowledgeSource,
    knowledgeChunk,
    knowledgeSharedBlock,
    knowledgeSharedBlockSource,
    storageCleanup,
  } = await import('../../src/db/schema')
  const { sweepStorageCleanup } =
    await import('../../src/services/knowledge/storageCleanup')
  const seed = spawn(
    process.execPath,
    ['scripts/seedLocal.ts', '--integration'],
    {
      cwd: new URL('../../', import.meta.url).pathname,
      env: process.env,
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  )
  assert.equal((await once(seed, 'exit'))[0], 0)
  const { loadTestCredentials } = await import('../../scripts/localSeedSupport')
  const credentials = await loadTestCredentials('integration')
  const [owner] = await db
    .insert(assistant)
    .values({
      organizationId: credentials.organizationId,
      name: 'Source operation regression',
    })
    .returning()
  const headers = {
    Cookie: credentials.accounts.owner.cookie,
    Origin: 'http://localhost:3000',
    'Content-Type': 'application/json',
  }
  const base = `${origin}/api/organizations/${credentials.organizationId}/assistants/${owner.id}`
  const request = (path: string, method = 'GET', body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const cleanupKeys: string[] = []
  try {
    const [root] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        kind: 'website',
        inputUrl: 'https://source-operation.example/',
      })
      .returning()
    const [pinned] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        parentId: root.id,
        kind: 'webPage',
        isPinned: true,
        status: 'ready',
        canonicalUrl: 'https://source-operation.example/hours',
        cleanedText: 'Appointments by booking.',
      })
      .returning()
    const contentVector = Array.from({ length: 384 }, (_, index) =>
      index === 0 ? 1 : 0,
    )
    const sharedVector = Array.from({ length: 384 }, (_, index) =>
      index === 1 ? 1 : 0,
    )
    await db.insert(knowledgeChunk).values({
      organizationId: orgOf(owner.id),
      sourceId: pinned.id,
      position: 0,
      text: pinned.cleanedText!,
      embedding: contentVector,
      embeddingModel: 'text-embedding-3-small',
    })
    const blockId = crypto.randomUUID()
    await db.insert(knowledgeSharedBlock).values({
      id: blockId,
      organizationId: orgOf(owner.id),
      websiteId: root.id,
      text: 'Opening hours: Monday to Friday, 9am to 5pm.',
      embedding: sharedVector,
      embeddingModel: 'text-embedding-3-small',
    })
    await db
      .insert(knowledgeSharedBlockSource)
      .values({ blockId, sourceId: pinned.id })
    const [pinnedRun] = await db
      .insert(indexRun)
      .values({
        organizationId: orgOf(owner.id),
        targetSourceId: pinned.id,
        trigger: 'manual',
        status: 'running',
      })
      .returning()
    // Deleting is never blocked by reading: the child's refresh just stops.
    assert.equal((await request(`/sources/${root.id}`, 'DELETE')).status, 204)
    const [stoppedRun] = await db
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, pinnedRun.id))
    assert.equal(stoppedRun.status, 'completed')
    const preservedResponse = await request(`/sources/${pinned.id}`)
    assert.equal(preservedResponse.status, 200)
    const preserved = (await preservedResponse.json()) as {
      parentId: string | null
      status: string
      cleanedText: string
    }
    assert.equal(preserved.parentId, null)
    assert.equal(preserved.status, 'ready')
    assert.match(preserved.cleanedText, /Opening hours: Monday to Friday/)
    const chunks = await db
      .select()
      .from(knowledgeChunk)
      .where(eq(knowledgeChunk.sourceId, pinned.id))
    assert.equal(chunks.length, 2)
    assert.deepEqual(
      chunks.find((chunk) => chunk.text.startsWith('Opening hours'))?.embedding,
      sharedVector,
    )
    assert.equal(
      (
        await db
          .select()
          .from(knowledgeSharedBlock)
          .where(eq(knowledgeSharedBlock.websiteId, root.id))
      ).length,
      0,
    )

    const objectKey = `assistants/${owner.id}/${crypto.randomUUID()}`
    cleanupKeys.push(objectKey)
    objects.add(`/uploads/${objectKey}`)
    const [upload] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        kind: 'upload',
        objectKey,
      })
      .returning()
    assert.equal(
      (await request(`/sources/${upload.id}`, 'DELETE')).status,
      204,
      'Storage outage must leave a durable cleanup intent',
    )
    assert.equal((await request(`/sources/${upload.id}`)).status, 404)
    const [pending] = await db
      .select()
      .from(storageCleanup)
      .where(eq(storageCleanup.objectKey, objectKey))
    assert.ok(pending)
    assert.equal(pending.attemptCount, 1)
    assert.equal(objects.size, 1)
    failDeletes = false
    await db
      .update(storageCleanup)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(storageCleanup.objectKey, objectKey))
    await sweepStorageCleanup([objectKey])
    await sweepStorageCleanup([objectKey])
    assert.equal(objects.size, 0)
    assert.ok(deletionAttempts >= 2)
    assert.equal(
      (
        await db
          .select()
          .from(storageCleanup)
          .where(eq(storageCleanup.objectKey, objectKey))
      ).length,
      0,
    )

    const created = await Promise.all([
      request('/sources', 'POST', {
        kind: 'website',
        url: 'https://duplicate-source.example/one',
      }),
      request('/sources', 'POST', {
        kind: 'website',
        url: 'https://duplicate-source.example/two',
      }),
    ])
    assert.deepEqual(
      created.map((response) => response.status).sort(),
      [201, 409],
    )

    const [scopedRoot] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        kind: 'website',
        inputUrl: 'https://redirect-scope.example/',
      })
      .returning()
    const [redirected] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        parentId: scopedRoot.id,
        kind: 'webPage',
        status: 'ready',
        canonicalUrl: 'https://redirect-scope.example/public',
        evidenceUrl: 'https://redirect-scope.example/internal',
      })
      .returning()
    assert.equal(
      (
        await request(`/sources/${scopedRoot.id}`, 'PATCH', {
          excludePaths: ['/internal'],
        })
      ).status,
      200,
    )
    const redirectedResponse = await request(`/sources/${redirected.id}`)
    assert.equal(redirectedResponse.status, 200)
    assert.equal(
      ((await redirectedResponse.json()) as { status: string }).status,
      'excluded',
    )

    const [racing] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        kind: 'webPage',
        canonicalUrl: 'https://source-operation.example/race',
        inputUrl: 'https://source-operation.example/race',
      })
      .returning()
    const [deletion, refresh] = await Promise.all([
      request(`/sources/${racing.id}`, 'DELETE'),
      request(`/sources/${racing.id}/runs`, 'POST'),
    ])
    // Whichever lands first, the delete wins and leaves no job running.
    assert.equal(deletion.status, 204)
    assert.ok(
      [202, 404].includes(refresh.status),
      `Unexpected refresh result: ${refresh.status}`,
    )
    assert.equal((await request(`/sources/${racing.id}`)).status, 404)
    // A deleted source's runs lose their target; none may be left active.
    assert.equal(
      (
        await db
          .select()
          .from(indexRun)
          .where(
            and(
              eq(indexRun.organizationId, orgOf(owner.id)),
              isNull(indexRun.targetSourceId),
              inArray(indexRun.status, ['queued', 'running']),
            ),
          )
      ).length,
      0,
    )

    // A page deleted from a website keeps an excluded marker, so the next
    // refresh can't add it back, and everything learned from it is gone.
    const [site] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        kind: 'website',
        inputUrl: 'https://deleted-page.example/',
        status: 'ready',
      })
      .returning()
    const [page] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        parentId: site.id,
        kind: 'webPage',
        status: 'ready',
        canonicalUrl: 'https://deleted-page.example/pricing',
        cleanedText: 'Shop add-on: $200.',
        contentHash: 'hash-before-delete',
      })
      .returning()
    await db.insert(knowledgeChunk).values({
      organizationId: orgOf(owner.id),
      sourceId: page.id,
      position: 0,
      text: page.cleanedText!,
      embedding: contentVector,
      embeddingModel: 'text-embedding-3-small',
    })
    assert.equal((await request(`/sources/${page.id}`, 'DELETE')).status, 204)
    const markerResponse = await request(`/sources/${page.id}`)
    assert.equal(markerResponse.status, 200)
    const marker = (await markerResponse.json()) as {
      isIncluded: boolean
      cleanedText: string | null
    }
    assert.equal(marker.isIncluded, false)
    assert.equal(marker.cleanedText, null)
    assert.equal(
      (
        await db
          .select()
          .from(knowledgeChunk)
          .where(eq(knowledgeChunk.sourceId, page.id))
      ).length,
      0,
    )
    // Including it again reads it afresh, since nothing was kept.
    assert.equal(
      (await request(`/sources/${page.id}`, 'PATCH', { isIncluded: true }))
        .status,
      200,
    )
    assert.equal(
      (
        await db
          .select()
          .from(indexRun)
          .where(eq(indexRun.targetSourceId, page.id))
      ).length,
      1,
    )
  } finally {
    await db
      .delete(indexRun)
      .where(eq(indexRun.organizationId, orgOf(owner.id)))
    // Detach any surviving children before removing this test's source rows.
    await db
      .update(knowledgeSource)
      .set({ parentId: null })
      .where(eq(knowledgeSource.organizationId, orgOf(owner.id)))
    await db
      .delete(knowledgeSource)
      .where(eq(knowledgeSource.organizationId, orgOf(owner.id)))
    await db.delete(assistant).where(eq(assistant.id, owner.id))
    if (cleanupKeys.length)
      await db
        .delete(storageCleanup)
        .where(inArray(storageCleanup.objectKey, cleanupKeys))
    const { getBoss } = await import('../../src/services/queue/boss')
    await (await getBoss()).stop()
    server.stop(true)
    fixture.stop(true)
  }
}, 120_000)

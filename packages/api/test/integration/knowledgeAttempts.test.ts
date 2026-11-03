import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { and, eq } from 'drizzle-orm'

// Supplemental state-transition regressions. HTTP suites cover source/run
// creation; direct helpers let overlapping deliveries be ordered deterministically.
test('knowledge results use run versions and independent fenced stage budgets', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Knowledge attempt regression requires local PostgreSQL')
  Object.assign(process.env, {
    NODE_ENV: 'test',
    FRONT_END_URL: 'http://localhost:3000',
    PORT: '3001',
    BETTER_AUTH_URL: 'http://localhost:3001',
  })
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
  const { db } = await import('../../src/db')
  const { assistant, indexRun, indexRunItem, knowledgeSource } =
    await import('../../src/db/schema')
  const {
    claimPageAttempt,
    deferPageAttempt,
    exhaustedPageStage,
    pageAttemptLimitExceeded,
  } = await import('../../src/services/knowledge/pageAttempts')
  const { recordIndexItemOutcome } =
    await import('../../src/services/knowledge/pageOutcomes')
  const { failPage } = await import('../../src/services/knowledge/pageFailure')
  const { knowledgeConfig } = await import('../../src/config/knowledge.config')
  const [owner] = await db
    .insert(assistant)
    .values({
      organizationId: credentials.organizationId,
      name: 'Knowledge attempts regression',
    })
    .returning()
  async function createSource() {
    const [source] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        kind: 'webPage',
        status: 'ready',
        canonicalUrl: `https://example.com/${crypto.randomUUID()}`,
      })
      .returning()
    return source
  }
  async function createRun(
    sourceId: string,
    startedAt = new Date(),
    item: Partial<typeof indexRunItem.$inferInsert> = {},
  ) {
    // Different website/page targets can touch one page. The helper fixture
    // omits targets so the one-active-run-per-target constraint stays respected.
    const [run] = await db
      .insert(indexRun)
      .values({
        organizationId: orgOf(owner.id),
        trigger: 'manual',
        status: 'running',
        phase: 'preparing',
        startedAt,
        discoveredCount: 1,
      })
      .returning()
    await db.insert(indexRunItem).values({ ...item, runId: run.id, sourceId })
    return run
  }
  const readItem = async (runId: string, sourceId: string) => {
    const [item] = await db
      .select()
      .from(indexRunItem)
      .where(
        and(eq(indexRunItem.runId, runId), eq(indexRunItem.sourceId, sourceId)),
      )
    return item
  }
  const readSource = async (sourceId: string) => {
    const [source] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, sourceId))
    return source
  }
  try {
    // Both runs start before either completes: B must replace A despite A's
    // completion time being later than B's start time.
    const source = await createSource()
    const startedA = new Date(Date.now() - 20_000)
    const startedB = new Date(Date.now() - 10_000)
    const runA = await createRun(source.id, startedA, {
      status: 'preparing',
      attemptCount: 1,
    })
    const runB = await createRun(source.id, startedB, {
      status: 'preparing',
      attemptCount: 1,
    })
    assert.equal(
      await recordIndexItemOutcome(
        runA.id,
        source.id,
        'unchanged',
        'preparing',
        1,
        undefined,
        { httpValidators: { etag: 'version-a', lastModifiedHeader: null } },
      ),
      true,
    )
    const resultA = await readSource(source.id)
    assert(resultA.lastCheckedAt! > startedB)
    assert.equal(resultA.resultStartedAt?.getTime(), startedA.getTime())
    assert.equal(
      await recordIndexItemOutcome(
        runB.id,
        source.id,
        'unchanged',
        'preparing',
        1,
        undefined,
        { httpValidators: { etag: 'version-b', lastModifiedHeader: null } },
      ),
      true,
    )
    const resultB = await readSource(source.id)
    assert.equal(
      resultB.etag,
      'version-b',
      'Newer-started result must replace older completed result',
    )
    assert.equal(resultB.resultStartedAt?.getTime(), startedB.getTime())
    const lateA = await createRun(source.id, startedA, {
      status: 'preparing',
      attemptCount: 1,
    })
    await recordIndexItemOutcome(
      lateA.id,
      source.id,
      'unchanged',
      'preparing',
      1,
      undefined,
      { httpValidators: { etag: 'stale-a', lastModifiedHeader: null } },
    )
    assert.equal(
      (await readSource(source.id)).etag,
      'version-b',
      'Late older result must not overwrite B',
    )
    const lateFailure = await createRun(source.id, startedA, {
      status: 'preparing',
      attemptCount: 1,
    })
    await recordIndexItemOutcome(
      lateFailure.id,
      source.id,
      'failed',
      'preparing',
      1,
      { message: 'Older refresh failed late' },
    )
    assert.equal(
      (await readSource(source.id)).lastError,
      null,
      'An older failure must not replace a newer successful result',
    )

    // Failure completion must obey the same start-order rule as successful
    // checks: an early run failing after B starts cannot block B's success.
    const failureSource = await createSource()
    const failedA = await createRun(failureSource.id, startedA, {
      status: 'preparing',
      attemptCount: 1,
    })
    const successfulB = await createRun(failureSource.id, startedB, {
      status: 'preparing',
      attemptCount: 1,
    })
    await recordIndexItemOutcome(
      failedA.id,
      failureSource.id,
      'failed',
      'preparing',
      1,
      { message: 'Temporary older failure' },
    )
    assert.equal(
      (await readSource(failureSource.id)).lastError,
      'Temporary older failure',
    )
    await recordIndexItemOutcome(
      successfulB.id,
      failureSource.id,
      'unchanged',
      'preparing',
      1,
      undefined,
      { httpValidators: { etag: 'recovered-b', lastModifiedHeader: null } },
    )
    const recovered = await readSource(failureSource.id)
    assert.equal(recovered.etag, 'recovered-b')
    assert.equal(recovered.lastError, null)
    assert.equal(recovered.resultStartedAt?.getTime(), startedB.getTime())

    // Conversely, a newer failure must survive an older success arriving late.
    const newerFailureSource = await createSource()
    const olderSuccess = await createRun(newerFailureSource.id, startedA, {
      status: 'preparing',
      attemptCount: 1,
    })
    const newerFailure = await createRun(newerFailureSource.id, startedB, {
      status: 'preparing',
      attemptCount: 1,
    })
    await recordIndexItemOutcome(
      newerFailure.id,
      newerFailureSource.id,
      'failed',
      'preparing',
      1,
      { message: 'Latest refresh failed' },
    )
    await recordIndexItemOutcome(
      olderSuccess.id,
      newerFailureSource.id,
      'unchanged',
      'preparing',
      1,
      undefined,
      {
        httpValidators: { etag: 'obsolete-success', lastModifiedHeader: null },
      },
    )
    const retainedFailure = await readSource(newerFailureSource.id)
    assert.equal(retainedFailure.lastError, 'Latest refresh failed')
    assert.equal(retainedFailure.etag, null)
    assert.equal(retainedFailure.resultStartedAt?.getTime(), startedB.getTime())

    // Preparation consumes its entire allowance, but embedding owns a fresh budget.
    const preparedSource = await createSource()
    const preparedRun = await createRun(preparedSource.id, new Date(), {
      status: 'prepared',
      attemptCount: knowledgeConfig.pageAttempts,
      prepareAttempts: knowledgeConfig.pageAttempts,
    })
    assert.equal(
      exhaustedPageStage(await readItem(preparedRun.id, preparedSource.id)),
      false,
    )
    await db
      .update(indexRunItem)
      .set({ status: 'embedding' })
      .where(eq(indexRunItem.runId, preparedRun.id))
    const embedding = await claimPageAttempt(
      preparedRun.id,
      preparedSource.id,
      'embed',
    )
    assert(embedding)
    assert.equal(embedding.attemptCount, knowledgeConfig.pageAttempts + 1)
    assert.equal(embedding.embedAttempts, 1)
    assert.equal(pageAttemptLimitExceeded(embedding, 'embed'), false)
    assert.equal(
      await recordIndexItemOutcome(
        preparedRun.id,
        preparedSource.id,
        'indexed',
        'embedding',
        embedding.attemptCount,
      ),
      true,
    )
    assert.equal(
      (await readItem(preparedRun.id, preparedSource.id)).status,
      'indexed',
    )

    // A worker whose lease expired cannot fail the delivery that replaced it.
    const fencedSource = await createSource()
    const fencedRun = await createRun(fencedSource.id)
    const first = await claimPageAttempt(
      fencedRun.id,
      fencedSource.id,
      'prepare',
    )
    assert(first)
    await db
      .update(indexRunItem)
      .set({ leaseUntil: new Date(Date.now() - 1) })
      .where(eq(indexRunItem.runId, fencedRun.id))
    const second = await claimPageAttempt(
      fencedRun.id,
      fencedSource.id,
      'prepare',
    )
    assert(second)
    assert(second.attemptCount > first.attemptCount)
    assert.equal(
      await failPage(
        fencedRun.id,
        fencedSource.id,
        new Error('stale worker failure'),
        first.attemptCount,
      ),
      false,
    )
    assert.deepEqual(await readItem(fencedRun.id, fencedSource.id), second)

    // Rate-limit waits refund only preparation attempts; fencing tokens never rewind.
    const deferredSource = await createSource()
    const deferredRun = await createRun(deferredSource.id)
    const deferrals = knowledgeConfig.pageAttempts + 3
    for (let attempt = 1; attempt <= deferrals; attempt++) {
      const claim = await claimPageAttempt(
        deferredRun.id,
        deferredSource.id,
        'prepare',
      )
      assert(claim)
      assert.equal(claim.attemptCount, attempt)
      assert.equal(claim.prepareAttempts, 1)
      assert.equal(pageAttemptLimitExceeded(claim, 'prepare'), false)
      const changed = await deferPageAttempt(
        deferredRun.id,
        deferredSource.id,
        claim.attemptCount,
        Date.now() - 1,
      )
      assert.equal(changed.length, 1)
      const deferred = await readItem(deferredRun.id, deferredSource.id)
      assert.equal(deferred.prepareAttempts, 0)
      assert.equal(deferred.attemptCount, attempt)
      assert.equal(exhaustedPageStage(deferred), false)
    }
    const finalClaim = await claimPageAttempt(
      deferredRun.id,
      deferredSource.id,
      'prepare',
    )
    assert(finalClaim)
    assert.equal(finalClaim.prepareAttempts, 1)
    assert.equal(finalClaim.attemptCount, deferrals + 1)
  } finally {
    await db
      .delete(indexRun)
      .where(eq(indexRun.organizationId, orgOf(owner.id)))
    await db
      .delete(knowledgeSource)
      .where(eq(knowledgeSource.organizationId, orgOf(owner.id)))
    await db.delete(assistant).where(eq(assistant.id, owner.id))
  }
}, 60_000)

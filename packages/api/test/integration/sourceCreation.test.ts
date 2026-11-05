import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { createTestWorkspace } from '../fixtures/ownWebsite'

test('HTTP source creation commits its initial run atomically and survives queue outage', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Source creation test requires local PostgreSQL')
  const objects = new Set<string>()
  const storage = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const key = new URL(request.url).pathname
      if (request.method === 'PUT') {
        objects.add(key)
        return new Response(null)
      }
      if (request.method === 'DELETE') {
        objects.delete(key)
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 404 })
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
    R2_ENDPOINT: `http://127.0.0.1:${storage.port}`,
    R2_BUCKET: 'uploads',
    R2_ACCESS_KEY_ID: 'fixture',
    R2_SECRET_ACCESS_KEY: 'fixture',
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
  const { app } = await import('../../src/app')
  handle = (request) => app.fetch(request)
  const { db } = await import('../../src/db')
  const { knowledgeSource, indexRun } = await import('../../src/db/schema')
  const { getBoss } = await import('../../src/services/queue/boss')
  const boss = await getBoss()
  const send = boss.send
  const fixtureName = `creation_${crypto.randomUUID().replaceAll('-', '_')}`
  const trigger = `fail_${fixtureName}`
  const site = `https://atomic-${crypto.randomUUID().slice(0, 8)}.example`
  const workspace = await createTestWorkspace(credentials, fixtureName)
  const base = `${origin}/api/organizations/${workspace.organizationId}/business`
  const headers = {
    Cookie: credentials.accounts.owner.cookie,
    Origin: 'http://localhost:3000',
  }
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const upload = () => {
    const form = new FormData()
    form.set(
      'file',
      new File(['Saved upload evidence.'], 'evidence.txt', {
        type: 'text/plain',
      }),
    )
    return fetch(`${base}/uploads`, {
      method: 'POST',
      headers,
      body: form,
    })
  }
  const dropFailure = async () => {
    await db.execute(
      sql.raw(`DROP TRIGGER IF EXISTS "${trigger}" ON index_run`),
    )
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS "${trigger}"()`))
  }
  try {
    // Scoped to this fixture's workspace; failing the run INSERT must roll
    // back source creation, rather than leave unscheduled sources behind.
    await db.execute(
      sql.raw(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.organization_id = '${workspace.organizationId}' THEN
        RAISE EXCEPTION 'Injected initial run persistence failure';
      END IF;
      RETURN NEW;
    END $$`),
    )
    await db.execute(
      sql.raw(
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON index_run FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`,
      ),
    )
    assert.equal(
      (
        await post('/sources', {
          kind: 'website',
          url: `${site}/`,
        })
      ).status,
      500,
    )
    assert.equal(
      (
        await post('/sources', {
          kind: 'webPage',
          url: `${site}/page`,
        })
      ).status,
      500,
    )
    assert.equal((await upload()).status, 500)
    assert.equal(
      (
        await db
          .select()
          .from(knowledgeSource)
          .where(eq(knowledgeSource.organizationId, workspace.organizationId))
      ).length,
      0,
    )
    assert.equal(objects.size, 0, 'Rolled-back upload must release its object')
    await dropFailure()

    boss.send = (async () => {
      throw new Error('Injected queue outage')
    }) as typeof boss.send
    const responses = [
      await post('/sources', { kind: 'website', url: `${site}/` }),
      await post('/sources', {
        kind: 'webPage',
        url: `${site}/page`,
      }),
      await upload(),
    ]
    for (const response of responses) {
      assert.equal(response.status, 201)
      const created = (await response.json()) as {
        source: { id: string }
        indexRun: { id: string }
      }
      const [run] = await db
        .select()
        .from(indexRun)
        .where(eq(indexRun.id, created.indexRun.id))
      assert.equal(run.targetSourceId, created.source.id)
      assert.equal(
        run.status,
        'queued',
        'Failed dispatch must leave durable work for recovery',
      )
      assert.equal(
        (
          await db
            .select()
            .from(knowledgeSource)
            .where(eq(knowledgeSource.id, run.targetSourceId!))
        ).length,
        1,
      )
    }
  } finally {
    boss.send = send
    await dropFailure()
    const sources = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.organizationId, workspace.organizationId))
    const { deleteStoredObject } =
      await import('../../src/services/knowledge/r2Storage')
    for (const source of sources)
      if (source.objectKey) await deleteStoredObject(source.objectKey)
    await db
      .delete(indexRun)
      .where(eq(indexRun.organizationId, workspace.organizationId))
    await db
      .delete(knowledgeSource)
      .where(eq(knowledgeSource.organizationId, workspace.organizationId))
    await boss.stop()
    server.stop(true)
    storage.stop(true)
  }
}, 60_000)

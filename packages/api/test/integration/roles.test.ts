import { createWithOwnWebsite } from '../fixtures/ownWebsite'
import { orgOf } from '../fixtures/knowledgeOwner'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { afterAll, beforeAll, test } from 'bun:test'
import { z } from 'zod'
import type { tTestRole } from '../../scripts/localSeedSupport'
import { startRolesProviders } from '../fixtures/rolesProviders'

let api: ReturnType<typeof spawn> | undefined
let worker: ReturnType<typeof spawn> | undefined
let providers: ReturnType<typeof startRolesProviders> | undefined

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  ) {
    throw new Error('Integration tests require local PostgreSQL')
  }

  const portServer = createServer()
  portServer.listen(0, '127.0.0.1')
  await once(portServer, 'listening')
  const address = portServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Could not reserve a local API port')
  }
  const port = address.port
  await new Promise<void>((resolve, reject) => {
    portServer.close((error) => (error ? reject(error) : resolve()))
  })

  const apiOrigin = `http://127.0.0.1:${port}`
  process.env.PORT = String(port)
  process.env.BETTER_AUTH_URL = apiOrigin
  process.env.FRONT_END_URL = 'http://localhost:3000'
  process.env.NODE_ENV = 'test'
  providers = startRolesProviders()
  Object.assign(process.env, providers.env)

  api = spawn(
    process.execPath,
    ['--preload', './test/fixtures/rolesChatModel.ts', 'src/index.ts'],
    {
      cwd: new URL('../../', import.meta.url).pathname,
      env: process.env,
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  )

  let ready = false
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${apiOrigin}/api/health`, {
        signal: AbortSignal.timeout(500),
      })
      if (response.ok) {
        ready = true
        break
      }
    } catch {
      // The API may still be starting.
    }
    await Bun.sleep(100)
  }
  if (!ready) throw new Error('The local API did not start')

  const seed = spawn(
    process.execPath,
    ['scripts/seedLocal.ts', '--integration'],
    {
      cwd: new URL('../../', import.meta.url).pathname,
      env: process.env,
      stdio: 'inherit',
    },
  )
  const [exitCode] = await once(seed, 'exit')
  if (exitCode !== 0) throw new Error('Local seed failed')
}, 30_000)

afterAll(async () => {
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    worker.kill('SIGTERM')
    await once(worker, 'exit')
  }
  if (api && api.exitCode === null && api.signalCode === null) {
    api.kill('SIGTERM')
    await once(api, 'exit')
  }
  providers?.server.stop(true)
})

const sessionSchema = z.object({
  user: z.object({ id: z.string() }),
  session: z.object({ activeOrganizationId: z.string().nullable().optional() }),
})
const organizationsSchema = z.array(z.object({ id: z.string() }))
const memberListSchema = z.object({
  members: z.array(
    z.object({ id: z.string(), userId: z.string(), role: z.string() }),
  ),
})
const permissionResultSchema = z.object({ success: z.boolean() })

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test('organization roles work through the running API', async () => {
  const { assertLocalTestEnvironment, loadTestCredentials, requestAs } =
    await import('../../scripts/localSeedSupport')
  assertLocalTestEnvironment()

  const credentials = await loadTestCredentials('integration')

  const roles: tTestRole[] = ['owner', 'admin', 'member', 'outsider']

  for (const role of roles) {
    const sessionResponse = await requestAs(credentials, role, '/get-session')
    const session = sessionSchema.safeParse(await sessionResponse.json())
    assert(
      sessionResponse.status === 200 &&
        session.success &&
        session.data.user.id === credentials.accounts[role].userId,
      `${role}: session failed; rerun the test user seed`,
    )
    assert(
      role === 'outsider' ||
        session.data.session.activeOrganizationId ===
          credentials.organizationId,
      `${role}: active organization mismatch`,
    )

    const listResponse = await requestAs(
      credentials,
      role,
      '/organization/list',
    )
    const organizations = organizationsSchema.safeParse(
      await listResponse.json(),
    )
    assert(
      listResponse.status === 200 && organizations.success,
      `${role}: organization list failed`,
    )
    assert(
      organizations.data.some(
        (item) => item.id === credentials.organizationId,
      ) ===
        (role !== 'outsider'),
      `${role}: organization visibility mismatch`,
    )
  }

  const membersPath = `/organization/list-members?organizationId=${encodeURIComponent(
    credentials.organizationId,
  )}`
  const membersResponse = await requestAs(credentials, 'admin', membersPath)
  const memberList = memberListSchema.safeParse(await membersResponse.json())
  assert(
    membersResponse.status === 200 && memberList.success,
    'Admin member list failed',
  )
  const ownerMember = memberList.data.members.find(
    (item) => item.userId === credentials.accounts.owner.userId,
  )
  assert(ownerMember?.role === 'owner', 'Test workspace owner is missing')

  const outsiderMembersResponse = await requestAs(
    credentials,
    'outsider',
    membersPath,
  )
  assert(
    outsiderMembersResponse.status === 403,
    'Outsider should not see workspace members',
  )

  const permissions = [
    {
      name: 'update organization',
      value: { organization: ['update'] },
      allowed: ['owner', 'admin'],
    },
    {
      name: 'delete organization',
      value: { organization: ['delete'] },
      allowed: ['owner'],
    },
    {
      name: 'invite members',
      value: { invitation: ['create'] },
      allowed: ['owner', 'admin'],
    },
    {
      name: 'change member roles',
      value: { member: ['update'] },
      allowed: ['owner', 'admin'],
    },
    {
      name: 'update the AI',
      value: { assistant: ['update'] },
      allowed: ['owner', 'admin'],
    },
    {
      name: 'read assistants',
      value: { assistant: ['read'] },
      allowed: ['owner', 'admin', 'member'],
    },
    {
      name: 'update leads',
      value: { lead: ['update'] },
      allowed: ['owner', 'admin', 'member'],
    },
  ] as const

  for (const permission of permissions) {
    for (const role of roles) {
      const response = await requestAs(
        credentials,
        role,
        '/organization/has-permission',
        {
          organizationId: credentials.organizationId,
          permissions: permission.value,
        },
      )

      if (role === 'outsider') {
        assert(
          response.status === 401,
          `${role}: ${permission.name} should require membership`,
        )
        continue
      }

      const result = permissionResultSchema.safeParse(await response.json())
      const allowed: readonly tTestRole[] = permission.allowed
      assert(
        response.status === 200 &&
          result.success &&
          result.data.success === allowed.includes(role),
        `${role}: incorrect permission to ${permission.name} (HTTP ${response.status})`,
      )
    }
  }

  const forbiddenInvite = await requestAs(
    credentials,
    'member',
    '/organization/invite-member',
    {
      organizationId: credentials.organizationId,
      email: 'never-send@anyhour.local',
      role: 'member',
    },
  )
  assert(
    forbiddenInvite.status === 403,
    'Member invitation should be forbidden',
  )

  const forbiddenOwnerChange = await requestAs(
    credentials,
    'admin',
    '/organization/update-member-role',
    {
      organizationId: credentials.organizationId,
      memberId: ownerMember.id,
      role: 'member',
    },
  )
  assert(
    forbiddenOwnerChange.status === 403,
    'Admin should not be able to change the owner',
  )

  const forbiddenOrganizationUpdate = await requestAs(
    credentials,
    'member',
    '/organization/update',
    {
      organizationId: credentials.organizationId,
      data: { name: 'Unauthorized change' },
    },
  )
  assert(
    forbiddenOrganizationUpdate.status === 403,
    'Member should not be able to update the organization',
  )

  const memberAccount = memberList.data.members.find(
    (item) => item.userId === credentials.accounts.member.userId,
  )
  assert(memberAccount?.role === 'member', 'Test workspace member is missing')

  try {
    const promoteResponse = await requestAs(
      credentials,
      'admin',
      '/organization/update-member-role',
      {
        organizationId: credentials.organizationId,
        memberId: memberAccount.id,
        role: 'admin',
      },
    )
    assert(promoteResponse.status === 200, 'Admin could not promote a member')

    const promotedMembersResponse = await requestAs(
      credentials,
      'owner',
      membersPath,
    )
    const promotedMembers = memberListSchema.safeParse(
      await promotedMembersResponse.json(),
    )
    assert(
      promotedMembersResponse.status === 200 &&
        promotedMembers.success &&
        promotedMembers.data.members.find(
          (item) => item.id === memberAccount.id,
        )?.role === 'admin',
      'Promoted role was not visible through the API',
    )
  } finally {
    const restoreResponse = await requestAs(
      credentials,
      'owner',
      '/organization/update-member-role',
      {
        organizationId: credentials.organizationId,
        memberId: memberAccount.id,
        role: 'member',
      },
    )
    assert(restoreResponse.status === 200, 'Could not restore the member role')

    const restoredMembersResponse = await requestAs(
      credentials,
      'owner',
      membersPath,
    )
    const restoredMembers = memberListSchema.safeParse(
      await restoredMembersResponse.json(),
    )
    assert(
      restoredMembersResponse.status === 200 &&
        restoredMembers.success &&
        restoredMembers.data.members.find(
          (item) => item.id === memberAccount.id,
        )?.role === 'member',
      'Member role was not restored through the API',
    )
  }
}, 30_000)

test('product routes, indexing, widget chat, forms, and lead retention work over HTTP', async () => {
  const { loadTestCredentials, requestAs } =
    await import('../../scripts/localSeedSupport')
  const credentials = await loadTestCredentials('integration')
  const base = `${credentials.apiOrigin}/api/organizations/${credentials.organizationId}`
  const request = (
    role: tTestRole,
    path: string,
    method = 'GET',
    body?: object,
  ) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        Cookie: credentials.accounts[role].cookie,
        Origin: 'http://localhost:3000',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

  let version = 1
  let failed = false
  let sitemapEnabled = true
  let fixturePort = 0
  const fixture = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      if (failed) return new Response('Unavailable', { status: 503 })
      const path = new URL(req.url).pathname
      if (path === '/sitemap.xml')
        if (!sitemapEnabled) return new Response('Not found', { status: 404 })
      if (path === '/sitemap.xml')
        return new Response(
          `<?xml version="1.0"?><urlset><url><loc>http://127.0.0.1:${fixturePort}/</loc></url><url><loc>http://127.0.0.1:${fixturePort}/hours</loc></url></urlset>`,
          { headers: { 'content-type': 'application/xml' } },
        )
      if (path === '/hours')
        return new Response(
          `<html><title>Opening hours</title><main><h1>Opening hours</h1><p>Open Monday to Friday, 9 AM to ${
            version === 1 ? '5 PM' : version === 2 ? '6 PM' : '7 PM'
          }.</p></main></html>`,
          { headers: { 'content-type': 'text/html' } },
        )
      if (req.headers.get('if-none-match') === '"root-v1"')
        return new Response(null, { status: 304 })
      return new Response(
        `<html><title>Test plumbing</title><nav>Navigation</nav><main><h1>Test plumbing</h1><p>We repair water heaters in Bristol.</p><a href="/hours">Hours</a></main></html>`,
        { headers: { 'content-type': 'text/html', etag: '"root-v1"' } },
      )
    },
  })
  fixturePort = fixture.port ?? 0

  worker = spawn(process.execPath, ['src/worker.ts'], {
    cwd: new URL('../../', import.meta.url).pathname,
    env: process.env,
    stdio: ['ignore', 'ignore', 'inherit'],
  })

  async function waitForRun(runId: string, assistantId: string) {
    // Durable recovery permits eight failed attempts, beyond queue delivery's
    // short retry window. Allow the minute recovery ticks to exhaust that budget.
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const response = await request('owner', `/assistants/${assistantId}/runs`)
      const runs = (await response.json()) as Array<{
        id: string
        status: string
      }>
      const run = runs.find((item) => item.id === runId)
      if (run && ['completed', 'failed'].includes(run.status)) return run.status
      await Bun.sleep(500)
    }
    throw new Error('Index run timed out')
  }

  try {
    const denied = await request('member', '/assistants', 'POST', {
      name: 'Denied',
      websiteUrl: `http://127.0.0.1:${fixture.port}/`,
    })
    assert(denied.status === 403, 'Member created an assistant')
    const outsider = await request('outsider', '/assistants')
    assert(outsider.status === 403, 'Outsider saw assistants')

    const createdResponse = await createWithOwnWebsite(
      (path, body) => request('owner', `/assistants${path}`, 'POST', body),
      {
        name: 'Test plumbing',
        websiteUrl: `http://127.0.0.1:${fixture.port}/`,
      },
    )
    assert(
      createdResponse.status === 201,
      `Assistant creation failed: ${createdResponse.status}`,
    )
    const created = (await createdResponse.json()) as {
      assistant: { id: string }
      source: { id: string }
      indexRun: { id: string }
    }
    const assistantId = created.assistant.id

    const foreignOrganizationResponse = await requestAs(
      credentials,
      'outsider',
      '/organization/create',
      {
        name: 'Foreign integration workspace',
        slug: `anyhour-foreign-${crypto.randomUUID()}`,
      },
    )
    assert(
      foreignOrganizationResponse.status === 200,
      'Could not create a second test organization',
    )
    const foreignOrganization = (await foreignOrganizationResponse.json()) as {
      id: string
    }
    try {
      const foreignAssistant = await fetch(
        `${credentials.apiOrigin}/api/organizations/${foreignOrganization.id}/assistants/${assistantId}`,
        {
          headers: { Cookie: credentials.accounts.outsider.cookie },
        },
      )
      assert(
        foreignAssistant.status === 404,
        'Assistant data leaked into another organization',
      )
      const ownerToForeign = await fetch(
        `${credentials.apiOrigin}/api/organizations/${foreignOrganization.id}/assistants`,
        { headers: { Cookie: credentials.accounts.owner.cookie } },
      )
      assert(
        ownerToForeign.status === 403,
        'Membership in one organization authorized another organization',
      )
    } finally {
      const deletedOrganization = await requestAs(
        credentials,
        'outsider',
        '/organization/delete',
        { organizationId: foreignOrganization.id },
      )
      assert(
        deletedOrganization.status === 200,
        'Could not clean up the second test organization',
      )
    }

    assert(
      Boolean(process.env.LLM_KEY || process.env.OPENAI_API_KEY),
      'The API integration test requires an OpenAI key',
    )
    {
      assert(
        (await waitForRun(created.indexRun.id, assistantId)) === 'completed',
        'Initial crawl did not complete',
      )
      const sourcesResponse = await request(
        'owner',
        `/assistants/${assistantId}/sources`,
      )
      const sources = (await sourcesResponse.json()) as Array<{
        id: string
        status: string
        title: string
        contentHash: string
      }>
      assert(
        sources.some(
          (item) => item.title === 'Opening hours' && item.status === 'ready',
        ),
        'Sitemap page was not indexed',
      )
      assert(
        Boolean(
          process.env.R2_ENDPOINT &&
          process.env.R2_BUCKET &&
          process.env.R2_ACCESS_KEY_ID &&
          process.env.R2_SECRET_ACCESS_KEY,
        ),
        'The API integration test requires R2 configuration',
      )
      const uploadBody = new FormData()
      uploadBody.set(
        'file',
        new File(
          ['Emergency plumbing is available on weekends.'],
          'services.txt',
          {
            type: 'text/plain',
          },
        ),
      )
      const uploadResponse = await fetch(
        `${base}/assistants/${assistantId}/uploads`,
        {
          method: 'POST',
          headers: {
            Cookie: credentials.accounts.owner.cookie,
            Origin: 'http://localhost:3000',
          },
          body: uploadBody,
        },
      )
      const uploadError =
        uploadResponse.status === 201
          ? null
          : ((await uploadResponse.clone().json()) as {
              error?: { code?: string }
            })
      assert(
        uploadResponse.status === 201,
        `R2-backed upload route failed (${uploadResponse.status}, ${
          uploadError?.error?.code ?? 'unknown'
        })`,
      )
      const uploaded = (await uploadResponse.json()) as {
        source: { id: string; objectKey: string }
        indexRun: { id: string }
      }
      try {
        assert(
          Boolean(uploaded.source.objectKey),
          'Upload object key is missing',
        )
        assert(
          (await waitForRun(uploaded.indexRun.id, assistantId)) === 'completed',
          'Uploaded file was not indexed',
        )
        const uploadedSource = (await (
          await request('owner', `/assistants/${assistantId}/sources`)
        ).json()) as typeof sources
        assert(
          uploadedSource.some(
            (item) => item.id === uploaded.source.id && item.status === 'ready',
          ),
          'Indexed upload was not visible through the API',
        )
      } finally {
        let removedStatus: number | undefined
        try {
          removedStatus = (
            await request(
              'owner',
              `/assistants/${assistantId}/sources/${uploaded.source.id}`,
              'DELETE',
            )
          ).status
        } finally {
          if (removedStatus !== 204) {
            const { deleteUpload } =
              await import('../../src/services/knowledge/upload')
            await deleteUpload(uploaded.source.objectKey)
          }
        }
        assert(removedStatus === 204, 'Uploaded R2 object was not cleaned up')
      }
      const hours = sources.find((item) => item.title === 'Opening hours')!
      version = 2
      const refreshResponse = await request(
        'owner',
        `/assistants/${assistantId}/sources/${hours.id}/runs`,
        'POST',
      )
      const refresh = (await refreshResponse.json()) as { id: string }
      assert(
        (await waitForRun(refresh.id, assistantId)) === 'completed',
        'Changed page refresh failed',
      )
      const refreshedSources = (await (
        await request('owner', `/assistants/${assistantId}/sources`)
      ).json()) as typeof sources
      const updatedHours = refreshedSources.find(
        (item) => item.id === hours.id,
      )!
      assert(
        updatedHours.contentHash !== hours.contentHash,
        'Changed content hash was not updated',
      )

      failed = true
      const failedResponse = await request(
        'owner',
        `/assistants/${assistantId}/sources/${hours.id}/runs`,
        'POST',
      )
      const failedRun = (await failedResponse.json()) as { id: string }
      assert(
        (await waitForRun(failedRun.id, assistantId)) === 'failed',
        'Failed refresh was not reported',
      )
      const retainedSources = (await (
        await request('owner', `/assistants/${assistantId}/sources`)
      ).json()) as typeof sources
      assert(
        retainedSources.find((item) => item.id === hours.id)?.contentHash ===
          updatedHours.contentHash,
        'Failed refresh removed usable content',
      )
      failed = false

      const publish = await request(
        'owner',
        `/assistants/${assistantId}`,
        'PATCH',
        { status: 'published' },
      )
      assert(publish.status === 200, 'Ready assistant could not be published')
      const origin = `http://127.0.0.1:${fixture.port}`
      const bootstrap = await fetch(
        `${credentials.apiOrigin}/api/widget/${assistantId}/bootstrap`,
        { method: 'POST', headers: { Origin: origin } },
      )
      assert(bootstrap.status === 200, 'Widget bootstrap failed')
      assert(
        bootstrap.headers.get('access-control-allow-origin') === origin,
        'Widget CORS is not available to the allowed website',
      )
      const badOrigin = await fetch(
        `${credentials.apiOrigin}/api/widget/${assistantId}/bootstrap`,
        {
          method: 'POST',
          headers: { Origin: 'https://not-approved.example' },
        },
      )
      assert(
        badOrigin.status === 403,
        'Unapproved website obtained an embed token',
      )
      const { token } = (await bootstrap.json()) as { token: string }
      const widgetHeaders = {
        Authorization: `Bearer ${token}`,
        Origin: origin,
      }
      const reusedToken = await fetch(
        `${credentials.apiOrigin}/api/widget/${assistantId}/config`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Origin: 'https://not-approved.example',
          },
        },
      )
      assert(
        reusedToken.status === 403,
        'An embed token worked from a different website origin',
      )
      const start = await fetch(
        `${credentials.apiOrigin}/api/widget/${assistantId}/conversations`,
        {
          method: 'POST',
          headers: { ...widgetHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ entryUrl: `${origin}/` }),
        },
      )
      assert(start.status === 201, 'Widget conversation start failed')
      const chat = (await start.json()) as { id: string; resumeToken: string }
      const history = await fetch(
        `${credentials.apiOrigin}/api/widget/${assistantId}/conversations/${chat.id}`,
        {
          headers: {
            ...widgetHeaders,
            'X-Conversation-Token': chat.resumeToken,
          },
        },
      )
      assert(history.status === 200, 'Conversation resume failed')
      const blockedHistory = await fetch(
        `${credentials.apiOrigin}/api/widget/${assistantId}/conversations/${chat.id}`,
        { headers: widgetHeaders },
      )
      assert(
        blockedHistory.status === 401,
        'Conversation transcript leaked without resume token',
      )
      const chatResponse = await fetch(
        `${credentials.apiOrigin}/api/widget/${assistantId}/conversations/${chat.id}/messages`,
        {
          method: 'POST',
          headers: {
            ...widgetHeaders,
            'X-Conversation-Token': chat.resumeToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: 'When do you close on weekdays?',
            clientMessageId: crypto.randomUUID(),
          }),
        },
      )
      assert(
        chatResponse.status === 200,
        `Chat request failed: ${chatResponse.status}`,
      )
      const events = await chatResponse.text()
      const answer = [...events.matchAll(/event: delta\ndata: ({.*})/g)]
        .map((match) => (JSON.parse(match[1]) as { text: string }).text)
        .join('')
      assert(
        events.includes('event: done') && /6(?::00)? PM/.test(answer),
        `Chat did not answer from refreshed knowledge: ${answer}`,
      )

      const unknownResponse = await fetch(
        `${credentials.apiOrigin}/api/widget/${assistantId}/conversations/${chat.id}/messages`,
        {
          method: 'POST',
          headers: {
            ...widgetHeaders,
            'X-Conversation-Token': chat.resumeToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: 'In what exact year was this plumbing business founded?',
            clientMessageId: crypto.randomUUID(),
          }),
        },
      )
      assert(unknownResponse.status === 200, 'Unknown-answer chat failed')
      const unknownEvents = await unknownResponse.text()
      const unknownAnswer = [
        ...unknownEvents.matchAll(/event: delta\ndata: ({.*})/g),
      ]
        .map((match) => (JSON.parse(match[1]) as { text: string }).text)
        .join('')
      assert(
        unknownEvents.includes('event: done') &&
          unknownAnswer.length > 0 &&
          !/\b(?:18|19|20)\d{2}\b/.test(unknownAnswer),
        `Chat invented an unsupported founding year: ${unknownAnswer}`,
      )
      const createdForm = await request(
        'owner',
        `/assistants/${assistantId}/forms`,
        'POST',
        {
          name: 'Request service',
          title: 'Request a callback',
          isDefault: true,
          fields: [
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'email', label: 'Email', type: 'email', required: true },
            { key: 'issue', label: 'Issue', type: 'textarea' },
          ],
        },
      )
      assert(createdForm.status === 201, 'Form creation failed')
      const form = (await createdForm.json()) as { id: string }
      const submitUrl = `${credentials.apiOrigin}/api/widget/${assistantId}/forms/${form.id}/submissions`
      const unpublishedSubmit = await fetch(submitUrl, {
        method: 'POST',
        headers: { ...widgetHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: { email: 'draft@example.com' },
          idempotencyKey: crypto.randomUUID(),
        }),
      })
      assert(
        unpublishedSubmit.status === 404,
        'An unpublished form accepted a public submission',
      )
      const publishedForm = await request(
        'owner',
        `/assistants/${assistantId}/forms/${form.id}`,
        'PATCH',
        { status: 'published' },
      )
      assert(publishedForm.status === 200, 'Form publish failed')
      const submitBody = {
        answers: {
          name: 'Ada',
          email: 'ada@example.com',
          issue: 'Water heater repair',
        },
        conversationId: chat.id,
        resumeToken: chat.resumeToken,
        idempotencyKey: crypto.randomUUID(),
      }
      const submit = () =>
        fetch(submitUrl, {
          method: 'POST',
          headers: { ...widgetHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(submitBody),
        })
      const first = await submit()
      const second = await submit()
      assert(
        first.status === 201 && second.status === 201,
        'Form submission failed',
      )
      const firstData = (await first.json()) as {
        id: string
        leadId: string
        contactId: string
      }
      const secondData = (await second.json()) as typeof firstData
      assert(
        firstData.id === secondData.id &&
          firstData.leadId === secondData.leadId,
        'Idempotency created a duplicate lead',
      )
      const unauthorizedReplay = await fetch(submitUrl, {
        method: 'POST',
        headers: { ...widgetHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...submitBody, resumeToken: 'invalid-token' }),
      })
      assert(
        unauthorizedReplay.status === 403,
        'Idempotency replay bypassed conversation authorization',
      )
      const repeat = await fetch(submitUrl, {
        method: 'POST',
        headers: { ...widgetHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...submitBody,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
      const repeatData = (await repeat.json()) as typeof firstData
      assert(
        repeat.status === 201 &&
          repeatData.contactId === firstData.contactId &&
          repeatData.leadId !== firstData.leadId,
        'One contact should have separate requests',
      )
      const merge = await request(
        'member',
        `/leads/${repeatData.leadId}/merge`,
        'POST',
        { targetLeadId: firstData.leadId },
      )
      assert(merge.status === 200, 'Member could not merge related leads')
      const deleteChat = await request(
        'owner',
        `/assistants/${assistantId}/conversations/${chat.id}`,
        'DELETE',
      )
      assert(deleteChat.status === 204, 'Conversation deletion failed')
      const retainedLead = await request('owner', `/leads/${firstData.leadId}`)
      assert(retainedLead.status === 200, 'Lead was deleted with conversation')
      const leadDetails = (await retainedLead.json()) as {
        contact: { id: string }
      }
      assert(
        leadDetails.contact.id === firstData.contactId,
        'Contact was deleted with conversation',
      )

      sitemapEnabled = false
      version = 3
      const noSitemapRefresh = await request(
        'owner',
        `/assistants/${assistantId}/sources/${created.source.id}/runs`,
        'POST',
      )
      const noSitemapRun = (await noSitemapRefresh.json()) as { id: string }
      assert(
        noSitemapRefresh.status === 202 &&
          (await waitForRun(noSitemapRun.id, assistantId)) === 'completed',
        'Website refresh without a sitemap failed',
      )
      const afterNoSitemap = (await (
        await request('owner', `/assistants/${assistantId}/sources`)
      ).json()) as typeof sources
      assert(
        afterNoSitemap.find((item) => item.id === hours.id)?.contentHash !==
          updatedHours.contentHash,
        'An unchanged root skipped a changed child page during refresh',
      )

      const exclude = await request(
        'owner',
        `/assistants/${assistantId}/sources/${created.source.id}`,
        'PATCH',
        { excludePaths: ['/hours'] },
      )
      assert(exclude.status === 200, 'Could not set a website exclusion')
      const exclusionRefresh = await request(
        'owner',
        `/assistants/${assistantId}/sources/${created.source.id}/runs`,
        'POST',
      )
      const exclusionRun = (await exclusionRefresh.json()) as { id: string }
      assert(
        exclusionRefresh.status === 202 &&
          (await waitForRun(exclusionRun.id, assistantId)) === 'completed',
        'Website exclusion refresh failed',
      )
      const excludedSources = (await (
        await request('owner', `/assistants/${assistantId}/sources`)
      ).json()) as Array<{ id: string; status: string }>
      assert(
        excludedSources.find((item) => item.id === hours.id)?.status ===
          'excluded',
        'An excluded page remained available as knowledge',
      )
      const excludedChatStart = await fetch(
        `${credentials.apiOrigin}/api/widget/${assistantId}/conversations`,
        {
          method: 'POST',
          headers: { ...widgetHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      assert(
        excludedChatStart.status === 201,
        'Could not start exclusion check',
      )
      const excludedChat = (await excludedChatStart.json()) as {
        id: string
        resumeToken: string
      }
      const excludedReply = await fetch(
        `${credentials.apiOrigin}/api/widget/${assistantId}/conversations/${excludedChat.id}/messages`,
        {
          method: 'POST',
          headers: {
            ...widgetHeaders,
            'X-Conversation-Token': excludedChat.resumeToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: 'What time does this business close on weekdays?',
            clientMessageId: crypto.randomUUID(),
          }),
        },
      )
      assert(excludedReply.status === 200, 'Exclusion check chat failed')
      const excludedEvents = await excludedReply.text()
      const excludedAnswer = [
        ...excludedEvents.matchAll(/event: delta\ndata: ({.*})/g),
      ]
        .map((match) => (JSON.parse(match[1]) as { text: string }).text)
        .join('')
      const excludedDone = excludedEvents.match(/event: done\ndata: ({.*})/)
      const excludedCitations = excludedDone
        ? ((
            JSON.parse(excludedDone[1]) as {
              citations: Array<{ sourceId: string }>
            }
          ).citations ?? [])
        : []
      assert(
        Boolean(excludedDone) &&
          !excludedCitations.some((item) => item.sourceId === hours.id) &&
          !/7(?::00)? PM/.test(excludedAnswer),
        `Excluded page influenced a public answer: ${excludedAnswer}`,
      )
      const include = await request(
        'owner',
        `/assistants/${assistantId}/sources/${created.source.id}`,
        'PATCH',
        { includePaths: ['/hours'], excludePaths: [] },
      )
      assert(include.status === 200, 'Could not set a website inclusion')
      const inclusionRefresh = await request(
        'owner',
        `/assistants/${assistantId}/sources/${created.source.id}/runs`,
        'POST',
      )
      const inclusionRun = (await inclusionRefresh.json()) as { id: string }
      assert(
        inclusionRefresh.status === 202 &&
          (await waitForRun(inclusionRun.id, assistantId)) === 'completed',
        'Website inclusion refresh failed',
      )
      const includedSources = (await (
        await request('owner', `/assistants/${assistantId}/sources`)
      ).json()) as Array<{ id: string; status: string }>
      assert(
        includedSources.find((item) => item.id === hours.id)?.status ===
          'ready',
        'An included page was not restored after refresh',
      )

      const { db } = await import('../../src/db')
      const { publicRateLimit } = await import('../../src/db/schema')
      const { and, eq } = await import('drizzle-orm')
      const bucketStart = new Date(Math.floor(Date.now() / 60_000) * 60_000)
      const keyHash = createHash('sha256')
        .update(`${assistantId}:${origin}:bootstrap`)
        .digest('hex')
      await db
        .insert(publicRateLimit)
        .values({
          keyHash,
          bucketStart,
          requestCount: 120,
          expiresAt: new Date(bucketStart.getTime() + 3_600_000),
        })
        .onConflictDoUpdate({
          target: [publicRateLimit.keyHash, publicRateLimit.bucketStart],
          set: { requestCount: 120 },
        })
      try {
        const limited = await fetch(
          `${credentials.apiOrigin}/api/widget/${assistantId}/bootstrap`,
          { method: 'POST', headers: { Origin: origin } },
        )
        assert(limited.status === 429, 'Public widget rate limit was bypassed')
      } finally {
        await db
          .delete(publicRateLimit)
          .where(
            and(
              eq(publicRateLimit.keyHash, keyHash),
              eq(publicRateLimit.bucketStart, bucketStart),
            ),
          )
      }
      const siteKeyHash = createHash('sha256')
        .update(`${assistantId}:${origin}:config:site`)
        .digest('hex')
      await db.insert(publicRateLimit).values({
        keyHash: siteKeyHash,
        bucketStart,
        requestCount: 1200,
        expiresAt: new Date(bucketStart.getTime() + 3_600_000),
      })
      try {
        const limited = await fetch(
          `${credentials.apiOrigin}/api/widget/${assistantId}/config`,
          { headers: widgetHeaders },
        )
        assert(
          limited.status === 429,
          'Assistant-wide widget rate limit was bypassed',
        )
      } finally {
        await db
          .delete(publicRateLimit)
          .where(
            and(
              eq(publicRateLimit.keyHash, siteKeyHash),
              eq(publicRateLimit.bucketStart, bucketStart),
            ),
          )
      }
    }
  } finally {
    fixture.stop(true)
  }
}, 600_000)

async function createPublicWidgetFixture() {
  const { loadTestCredentials } = await import('../../scripts/localSeedSupport')
  const { db } = await import('../../src/db')
  const { assistant } = await import('../../src/db/schema')
  const credentials = await loadTestCredentials('integration')
  const origin = `https://widget-${crypto.randomUUID()}.example`
  const [record] = await db
    .insert(assistant)
    .values({
      organizationId: credentials.organizationId,
      name: 'Public widget API test',
      status: 'published',
      allowedOrigins: [origin],
    })
    .returning({ id: assistant.id })
  const bootstrap = await fetch(
    `${credentials.apiOrigin}/api/widget/${record.id}/bootstrap`,
    { method: 'POST', headers: { Origin: origin } },
  )
  assert(bootstrap.status === 200, 'Could not bootstrap public widget test')
  const { token } = (await bootstrap.json()) as { token: string }
  return {
    db,
    credentials,
    assistantId: record.id,
    origin,
    headers: { Authorization: `Bearer ${token}`, Origin: origin },
  }
}

test('public form submissions fill empty contact fields and preserve existing values', async () => {
  const { credentials, assistantId, headers } =
    await createPublicWidgetFixture()
  const formsPath = `${credentials.apiOrigin}/api/organizations/${credentials.organizationId}/assistants/${assistantId}/forms`
  const ownerHeaders = {
    Cookie: credentials.accounts.owner.cookie,
    Origin: 'http://localhost:3000',
    'Content-Type': 'application/json',
  }
  const created = await fetch(formsPath, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      name: 'Contact',
      title: 'Request contact',
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'phone', label: 'Phone', type: 'phone' },
      ],
    }),
  })
  assert(created.status === 201, 'Could not create public form test fixture')
  const formRecord = (await created.json()) as { id: string }
  const published = await fetch(`${formsPath}/${formRecord.id}`, {
    method: 'PATCH',
    headers: ownerHeaders,
    body: JSON.stringify({ status: 'published' }),
  })
  assert(published.status === 200, 'Could not publish public form test fixture')
  const submitUrl = `${credentials.apiOrigin}/api/widget/${assistantId}/forms/${formRecord.id}/submissions`
  const submit = (answers: Record<string, string>) =>
    fetch(submitUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers, idempotencyKey: crypto.randomUUID() }),
    })
  const first = await submit({ name: 'Ada', email: 'ada@example.com' })
  assert(first.status === 201, 'Initial public form submission failed')
  const firstData = (await first.json()) as { contactId: string }
  const conflicting = await submit({
    name: 'Different Person',
    email: 'ada@example.com',
    phone: '+15551234567',
  })
  assert(conflicting.status === 201, 'Conflicting public submission failed')
  const conflictingData = (await conflicting.json()) as { leadId: string }
  const details = await fetch(
    `${credentials.apiOrigin}/api/organizations/${credentials.organizationId}/leads/${conflictingData.leadId}`,
    { headers: ownerHeaders },
  )
  const data = (await details.json()) as {
    contact: { id: string; name: string | null; phone: string | null }
    lead: { summary: string | null }
  }
  assert(
    details.status === 200 &&
      data.contact.id === firstData.contactId &&
      data.contact.name === 'Ada' &&
      data.contact.phone === '+15551234567' &&
      data.lead.summary?.includes('Different Person') === true,
    'Anonymous submission replaced a contact or lost submitted details',
  )
})

test('accepted form submissions replay after their conversation is deleted', async () => {
  const { credentials, assistantId, headers } =
    await createPublicWidgetFixture()
  const ownerHeaders = {
    Cookie: credentials.accounts.owner.cookie,
    Origin: 'http://localhost:3000',
    'Content-Type': 'application/json',
  }
  const formsPath = `${credentials.apiOrigin}/api/organizations/${credentials.organizationId}/assistants/${assistantId}/forms`
  const created = await fetch(formsPath, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      name: 'Callback',
      title: 'Request a callback',
      fields: [{ key: 'email', label: 'Email', type: 'email', required: true }],
    }),
  })
  assert(created.status === 201, 'Could not create replay form')
  const formRecord = (await created.json()) as { id: string }
  const published = await fetch(`${formsPath}/${formRecord.id}`, {
    method: 'PATCH',
    headers: ownerHeaders,
    body: JSON.stringify({ status: 'published' }),
  })
  assert(published.status === 200, 'Could not publish replay form')
  const started = await fetch(
    `${credentials.apiOrigin}/api/widget/${assistantId}/conversations`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{}',
    },
  )
  assert(started.status === 201, 'Could not start replay conversation')
  const chat = (await started.json()) as { id: string; resumeToken: string }
  const submissionUrl = `${credentials.apiOrigin}/api/widget/${assistantId}/forms/${formRecord.id}/submissions`
  const payload = {
    answers: { email: 'replay@example.com' },
    conversationId: chat.id,
    resumeToken: chat.resumeToken,
    idempotencyKey: crypto.randomUUID(),
  }
  const submit = (input: typeof payload) =>
    fetch(submissionUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const first = await submit(payload)
  assert(first.status === 201, 'Initial replay submission failed')
  const accepted = (await first.json()) as { id: string }
  const removed = await fetch(
    `${credentials.apiOrigin}/api/organizations/${credentials.organizationId}/assistants/${assistantId}/conversations/${chat.id}`,
    { method: 'DELETE', headers: ownerHeaders },
  )
  assert(removed.status === 204, 'Could not delete replay conversation')
  const replay = await submit(payload)
  assert(replay.status === 201, 'Accepted submission did not replay')
  assert(
    ((await replay.json()) as { id: string }).id === accepted.id,
    'Replay created a different submission',
  )
  const invalid = await submit({ ...payload, resumeToken: 'wrong-token' })
  assert(invalid.status === 403, 'Invalid token could replay a submission')
})

test('public chat rejects an accidental duplicate send', async () => {
  const { db, credentials, assistantId, headers } =
    await createPublicWidgetFixture()
  const { message: messageTable } = await import('../../src/db/schema')
  const { eq } = await import('drizzle-orm')
  const started = await fetch(
    `${credentials.apiOrigin}/api/widget/${assistantId}/conversations`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{}',
    },
  )
  assert(started.status === 201, 'Could not start public chat test')
  const chat = (await started.json()) as { id: string; resumeToken: string }
  const clientMessageId = crypto.randomUUID()
  const [pending] = await db
    .insert(messageTable)
    .values({
      conversationId: chat.id,
      role: 'visitor',
      content: 'Already received question',
      clientMessageId,
    })
    .returning({ id: messageTable.id })
  try {
    const overlapping = await fetch(
      `${credentials.apiOrigin}/api/widget/${assistantId}/conversations/${chat.id}/messages`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'X-Conversation-Token': chat.resumeToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'Already received question',
          clientMessageId,
        }),
      },
    )
    const body = (await overlapping.json()) as { error?: { code?: string } }
    assert(
      overlapping.status === 409 && body.error?.code === 'duplicate_message',
      'Duplicate chat send did not return a clear conflict',
    )
  } finally {
    await db.delete(messageTable).where(eq(messageTable.id, pending.id))
  }
})

test('public widget enforces its assistant-wide rate bucket', async () => {
  const { db, credentials, assistantId, origin, headers } =
    await createPublicWidgetFixture()
  const { publicRateLimit } = await import('../../src/db/schema')
  const { and, eq } = await import('drizzle-orm')
  const bucketStart = new Date(Math.floor(Date.now() / 60_000) * 60_000)
  const keyHash = createHash('sha256')
    .update(`${assistantId}:config:assistant`)
    .digest('hex')
  await db.insert(publicRateLimit).values({
    keyHash,
    bucketStart,
    requestCount: 1200,
    expiresAt: new Date(bucketStart.getTime() + 3_600_000),
  })
  try {
    const limited = await fetch(
      `${credentials.apiOrigin}/api/widget/${assistantId}/config`,
      { headers },
    )
    assert(limited.status === 429, 'Assistant-wide rate limit was bypassed')
  } finally {
    await db
      .delete(publicRateLimit)
      .where(
        and(
          eq(publicRateLimit.keyHash, keyHash),
          eq(publicRateLimit.bucketStart, bucketStart),
        ),
      )
  }
  const bootstrapKeyHash = createHash('sha256')
    .update(`${assistantId}:bootstrap:assistant`)
    .digest('hex')
  await db
    .insert(publicRateLimit)
    .values({
      keyHash: bootstrapKeyHash,
      bucketStart,
      requestCount: 1200,
      expiresAt: new Date(bucketStart.getTime() + 3_600_000),
    })
    .onConflictDoUpdate({
      target: [publicRateLimit.keyHash, publicRateLimit.bucketStart],
      set: { requestCount: 1200 },
    })
  try {
    const limitedBootstrap = await fetch(
      `${credentials.apiOrigin}/api/widget/${assistantId}/bootstrap`,
      { method: 'POST', headers: { Origin: origin } },
    )
    assert(
      limitedBootstrap.status === 429,
      'Assistant-wide bootstrap rate limit was bypassed',
    )
  } finally {
    await db
      .delete(publicRateLimit)
      .where(
        and(
          eq(publicRateLimit.keyHash, bootstrapKeyHash),
          eq(publicRateLimit.bucketStart, bucketStart),
        ),
      )
  }
})

test('source listing paginates without returning indexed content', async () => {
  const { db, credentials, assistantId } = await createPublicWidgetFixture()
  const { knowledgeSource } = await import('../../src/db/schema')
  const inserted = await db
    .insert(knowledgeSource)
    .values(
      Array.from({ length: 3 }, (_, position) => ({
        organizationId: orgOf(assistantId),
        kind: 'upload' as const,
        title: `Source ${position}`,
        objectKey: `private/source-${position}`,
        cleanedText: `private content ${position}`,
      })),
    )
    .returning({ id: knowledgeSource.id })
  const sourceUrl = `${credentials.apiOrigin}/api/organizations/${credentials.organizationId}/assistants/${assistantId}/sources`
  const headers = {
    Cookie: credentials.accounts.owner.cookie,
    Origin: 'http://localhost:3000',
  }
  const first = await fetch(`${sourceUrl}?limit=2`, { headers })
  const firstRows = (await first.json()) as Array<Record<string, unknown>>
  const cursor = first.headers.get('x-next-cursor')
  assert(
    first.status === 200 &&
      firstRows.length === 2 &&
      Boolean(cursor) &&
      firstRows.every(
        (row) => !('cleanedText' in row) && !('objectKey' in row),
      ),
    'First source page leaked content or omitted its cursor',
  )
  const second = await fetch(`${sourceUrl}?limit=2&cursor=${cursor}`, {
    headers,
  })
  const secondRows = (await second.json()) as Array<{ id: string }>
  assert(
    second.status === 200 &&
      secondRows.length === 1 &&
      !firstRows.some((row) => row.id === secondRows[0].id),
    'Second source page repeated or skipped a source',
  )
  const detail = await fetch(`${sourceUrl}/${inserted[0].id}`, { headers })
  const fullSource = (await detail.json()) as { cleanedText?: string }
  assert(
    detail.status === 200 && fullSource.cleanedText === 'private content 0',
    'Authorized source detail did not return cleaned text',
  )
  const { requestAs } = await import('../../scripts/localSeedSupport')
  const foreignCreated = await requestAs(
    credentials,
    'outsider',
    '/organization/create',
    {
      name: 'Source scope test',
      slug: `source-scope-${crypto.randomUUID()}`,
    },
  )
  assert(foreignCreated.status === 200, 'Could not create foreign workspace')
  const foreign = (await foreignCreated.json()) as { id: string }
  try {
    const foreignDetail = await fetch(
      `${credentials.apiOrigin}/api/organizations/${foreign.id}/assistants/${assistantId}/sources/${inserted[0].id}`,
      { headers: { Cookie: credentials.accounts.outsider.cookie } },
    )
    assert(
      foreignDetail.status === 404,
      'Source detail leaked into another organization',
    )
  } finally {
    const deleted = await requestAs(
      credentials,
      'outsider',
      '/organization/delete',
      { organizationId: foreign.id },
    )
    assert(deleted.status === 200, 'Could not remove foreign workspace')
  }
})

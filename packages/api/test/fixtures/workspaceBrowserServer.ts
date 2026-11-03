// Isolated browser-test server. It never uses live AI, email, or object storage.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { and, eq, inArray } from 'drizzle-orm'
import { startRolesProviders } from './rolesProviders'
import { installWorkspaceFixture } from './workspaceModel'

const value = process.env.DATABASE_URL
if (
  process.env.NODE_ENV === 'production' ||
  !value ||
  !['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname)
)
  throw new Error('Browser fixtures require local PostgreSQL')
const providers = startRolesProviders()
Object.assign(process.env, providers.env)
process.env.NODE_ENV = 'test'
process.env.PORT = '3191'
process.env.BETTER_AUTH_URL = 'http://localhost:3191'
process.env.FRONT_END_URL = 'http://localhost:3190'
// Slack shows as available on Channels (never called).
Object.assign(process.env, {
  SLACK_CLIENT_ID: 'browser-slack-client',
  SLACK_CLIENT_SECRET: 'browser-slack-secret',
  SLACK_SIGNING_SECRET: 'browser-slack-signing',
  // Customer WhatsApp is available, against a fake Graph API below.
  WHATSAPP_APP_SECRET: 'browser-whatsapp-secret',
  WHATSAPP_VERIFY_TOKEN: 'browser-whatsapp-verify',
})
const fakeGraph = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: () =>
    Response.json({ messages: [{ id: `wamid.browser.${Date.now()}` }] }),
})
const { customerWhatsappConfig } =
  await import('../../src/config/customerWhatsapp.config')
customerWhatsappConfig.graphApiUrl = `http://127.0.0.1:${fakeGraph.port}`
const { app } = await import('../../src/app')
installWorkspaceFixture()
const seed = spawn(
  process.execPath,
  ['scripts/seedLocal.ts', '--integration'],
  {
    cwd: new URL('../../', import.meta.url).pathname,
    env: process.env,
    stdio: ['ignore', 'ignore', 'inherit'],
  },
)
if ((await once(seed, 'exit'))[0] !== 0) throw new Error('Browser seed failed')
const { loadTestCredentials } = await import('../../scripts/localSeedSupport')
const credentials = await loadTestCredentials('integration')
const { db } = await import('../../src/db')
const {
  organization,
  member,
  assistant,
  knowledgeSource,
  indexRun,
  connection,
  contact,
  contactIdentity,
  conversation,
  message,
  whatsappAgent,
} = await import('../../src/db/schema')
const { encryptSecret, secretFingerprint } =
  await import('../../src/services/whatsapp/secret')
const { sealCredentials } =
  await import('../../src/services/connections/credentials')
const id = crypto.randomUUID()
await db.insert(organization).values({
  id,
  name: 'Browser test workspace',
  slug: id,
})
const ownerMemberId = crypto.randomUUID()
await db.insert(member).values({
  id: ownerMemberId,
  userId: credentials.accounts.owner.userId,
  organizationId: id,
  role: 'owner',
  createdAt: new Date(),
})
const [bot] = await db
  .insert(assistant)
  .values({
    organizationId: id,
    name: 'Willow Studio',
    welcomeMessage: 'Welcome to Willow Studio. What would you like to know?',
  })
  .returning()
// Your business.
await db.insert(knowledgeSource).values([
  {
    organizationId: id,
    kind: 'webPage',
    title: 'About Willow Studio',
    inputUrl: 'https://example.com/about',
    canonicalUrl: 'https://example.com/about',
    status: 'ready',
    lastIndexedAt: new Date(),
    cleanedText: 'Willow Studio is open Monday to Friday, 9 am to 5 pm.',
  },
  {
    organizationId: id,
    kind: 'webPage',
    title: 'Supplier price list',
    inputUrl: 'https://supplier.example/prices',
    canonicalUrl: 'https://supplier.example/prices',
    status: 'ready',
    lastIndexedAt: new Date(),
    cleanedText: 'Oak frames cost 40 each from the supplier.',
  },
])
// Channels: the owner's linked WhatsApp agent (never polled: no worker
// runs here) and a Slack workspace that stopped working.
const fakeKey = `browser-${id}`
await db.insert(whatsappAgent).values({
  organizationId: id,
  connectedByMemberId: ownerMemberId,
  assistantId: bot.id,
  tokenEncrypted: encryptSecret(fakeKey),
  tokenFingerprint: secretFingerprint(fakeKey),
  ownerUserId: 'user:browser',
  status: 'linked',
  linkedAt: new Date(),
})
await db.insert(connection).values({
  organizationId: id,
  provider: 'slack',
  status: 'broken',
  externalAccountId: `T${id}`,
  assistantId: bot.id,
  settings: { accountName: 'Willow Slack' },
  lastError:
    'Slack no longer accepts our app (token_revoked). Reconnect Slack.',
  connectedByMemberId: ownerMemberId,
})
// Customer WhatsApp: the business's number, answered by the AI team member,
// and one customer's conversation in the inbox.
const [number] = await db
  .insert(connection)
  .values({
    organizationId: id,
    provider: 'whatsapp_business',
    status: 'active',
    externalAccountId: `1${Date.now()}`,
    assistantId: bot.id,
    credentialsEncrypted: sealCredentials({ accessToken: 'browser-token' }),
    settings: {
      accountName: 'Willow Studio',
      displayPhoneNumber: '+44 7700 900000',
      businessAccountId: '204060801',
      templateLanguage: 'en',
    },
    connectedByMemberId: ownerMemberId,
  })
  .returning()
const [customer] = await db
  .insert(contact)
  .values({
    organizationId: id,
    name: 'Sara Malik',
    phone: '+447700900123',
    normalizedPhone: '+447700900123',
  })
  .returning()
await db.insert(contactIdentity).values({
  organizationId: id,
  contactId: customer.id,
  kind: 'whatsapp',
  value: '+447700900123',
  normalizedValue: '+447700900123',
  source: 'chat',
})
const [whatsappChat] = await db
  .insert(conversation)
  .values({
    assistantId: bot.id,
    contactId: customer.id,
    channel: 'whatsapp',
    connectionId: number.id,
    externalUserId: '447700900123',
    resumeTokenHash: crypto.randomUUID(),
    knownFields: { phone: '+447700900123' },
    lastMessageAt: new Date(),
  })
  .returning()
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)
await db.insert(message).values([
  {
    conversationId: whatsappChat.id,
    role: 'visitor',
    content: 'Hi, do you frame large prints?',
    clientMessageId: 'wamid.browser.in.1',
    externalId: 'wamid.browser.in.1',
    createdAt: minutesAgo(3),
  },
  {
    conversationId: whatsappChat.id,
    role: 'assistant',
    content:
      'Yes, we frame prints up to A0. Would you like a quote? https://example.com/framing',
    clientMessageId: 'wamid.browser.in.1:reply',
    externalId: 'wamid.browser.out.1',
    deliveryStatus: 'read',
    createdAt: minutesAgo(2),
  },
])
// A website chat where the AI team member showed chat UI blocks and the visitor
// tapped one and sent the contact form, for the inbox's read-only view.
const { chatBlocksSchema } = await import('../../src/schemas/chatBlock.schema')
const blocks = chatBlocksSchema.parse([
  {
    id: 'b_browserSizes',
    kind: 'choices',
    options: ['A2', 'A1', 'A0'].map((size) => ({ label: size, value: size })),
    fallback: '1. A2\n2. A1\n3. A0',
  },
])
const [checklist, form] = [
  {
    id: 'b_browserBring',
    kind: 'checklist',
    title: 'What to bring',
    items: [
      { text: 'The print, rolled not folded', done: false },
      { text: 'Rough frame size', done: true },
    ],
    fallback:
      'What to bring:\n1. The print, rolled not folded\n2. Rough frame size (done)',
  },
  {
    id: 'b_browserForm',
    kind: 'contactForm',
    ask: 'email',
    askName: true,
    topic: 'A1 framing quote',
    fallback: 'What’s the best email address to reach you?',
  },
].map((item) => chatBlocksSchema.parse([item]))
const [widgetChat] = await db
  .insert(conversation)
  .values({
    assistantId: bot.id,
    resumeTokenHash: crypto.randomUUID(),
    lastMessageAt: minutesAgo(1),
  })
  .returning()
await db.insert(message).values(
  [
    { role: 'visitor' as const, content: 'Can you frame a big poster?' },
    {
      role: 'assistant' as const,
      content: 'We can. Which size is it?',
      blocks,
    },
    {
      role: 'visitor' as const,
      content: 'A1',
      blockReply: { blockId: 'b_browserSizes', value: 'A1' },
    },
    { role: 'assistant' as const, content: '', blocks: checklist },
    {
      role: 'assistant' as const,
      content: 'Leave your email and we’ll send a quote.',
      blocks: form,
    },
    {
      role: 'visitor' as const,
      content: 'Name: Tom Reed\nEmail: tom@example.com',
      blockReply: { blockId: 'b_browserForm', value: 'sent' },
    },
  ].map((item, index) => ({
    ...item,
    conversationId: widgetChat.id,
    createdAt: minutesAgo(10 - index),
  })),
)
await writeFile(
  new URL('../../.local-test/browser-context.json', import.meta.url),
  JSON.stringify({
    organizationId: id,
    assistantId: bot.id,
    whatsappConversationId: whatsappChat.id,
    widgetConversationId: widgetChat.id,
  }),
)
const server = Bun.serve({
  hostname: 'localhost',
  port: 3191,
  fetch: (request) => {
    const path = new URL(request.url).pathname
    if (path === '/test-site' || path === '/blocked-site')
      return new Response(
        '<html><body style="font-family:system-ui;padding:60px;background:#fafafa"><h1>Willow Studio website</h1><p>Design that makes room for what matters.</p></body></html>',
        {
          headers: {
            'content-type': 'text/html',
            ...(path === '/blocked-site' ? { 'X-Frame-Options': 'DENY' } : {}),
          },
        },
      )
    return app.fetch(request)
  },
})
console.log('Browser fixture ready')
process.on('SIGTERM', async () => {
  server.stop(true)
  // Fixture uploads must never be picked up by a live local worker later.
  await db
    .update(indexRun)
    .set({
      status: 'failed',
      completedAt: new Date(),
      errorSummary: 'Browser fixture finished',
    })
    .where(
      and(
        eq(indexRun.organizationId, id),
        inArray(indexRun.status, ['queued', 'running']),
      ),
    )
  providers.server.stop(true)
  fakeGraph.stop(true)
  process.exit(0)
})

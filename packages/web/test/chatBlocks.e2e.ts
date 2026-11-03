import { readFile, readdir } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

// Chat UI blocks (docs/channels.md, wave 4): the built website widget at
// phone width against a stubbed widget API (a tap and the contact form go
// back with their block), and the inbox's read-only view of a seeded chat.

// https: the widget needs a secure context (crypto.randomUUID).
const site = 'https://site.test'
const api = 'https://api.test'
const widgetDist = new URL('../../widget/dist/', import.meta.url)

const blocks = {
  choices: {
    id: 'b_sizes',
    kind: 'choices',
    options: ['A2', 'A1', 'A0'].map((label) => ({ label, value: label })),
    fallback: '1. A2\n2. A1\n3. A0',
  },
  list: {
    id: 'b_times',
    kind: 'list',
    buttonLabel: 'See times',
    options: [
      { label: 'Tue 10:00', value: 'Tue 10:00', description: 'Studio' },
      { label: 'Wed 14:30', value: 'Wed 14:30' },
      { label: 'Sat 09:00', value: 'Sat 09:00', description: 'Busy day' },
    ],
    fallback: '',
  },
  checklist: {
    id: 'b_bring',
    kind: 'checklist',
    title: 'What to bring',
    items: [
      { text: 'The print, rolled not folded', done: false },
      { text: 'Rough frame size', done: true },
    ],
    fallback: '',
  },
  earlier: {
    id: 'b_earlier',
    kind: 'choices',
    options: ['Framing', 'Prints'].map((label) => ({ label, value: label })),
    fallback: '1. Framing\n2. Prints',
  },
  form: {
    id: 'b_form',
    kind: 'contactForm',
    ask: 'email',
    askName: true,
    topic: 'A1 framing quote',
    fallback: 'What’s the best email address to reach you?',
  },
}

const cors = {
  'access-control-allow-origin': site,
  'access-control-allow-headers':
    'authorization, content-type, x-conversation-token',
  'access-control-allow-methods': 'GET, POST',
}

async function stubWebsite(page: Page) {
  const chatFile = (await readdir(widgetDist)).find((name) =>
    /^chat-.+\.js$/.test(name),
  )
  if (!chatFile) throw new Error('Build the widget first (bun run build:embed)')
  const sent: Array<Record<string, unknown>> = []
  let replies = 0
  await page.route(`${site}/**`, async (route: Route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;margin:0;padding:24px"><h1>Willow Studio</h1><script src="${site}/embed.js" data-bot="bot" data-api="${api}" async></script></body></html>`,
      })
    const file = path.slice(1)
    if (file === 'embed.js' || file === chatFile)
      return route.fulfill({
        contentType: 'text/javascript; charset=utf-8',
        body: await readFile(new URL(file, widgetDist), 'utf8'),
      })
    return route.fulfill({ status: 404 })
  })
  await page.route(`${api}/**`, async (route: Route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    const path = new URL(request.url()).pathname.replace('/api/widget/bot', '')
    const json = (body: unknown) => route.fulfill({ headers: cors, json: body })
    if (path === '/launcher')
      return json({
        id: 'bot',
        name: 'Willow',
        welcomeMessage: 'Hi, I’m Willow. How can I help?',
        pictureUrl: null,
        appearance: {
          brandColor: '#2f5d50',
          launcher: 'icon',
          starterPrompts: [],
        },
        tracking: {
          visits: false,
          location: false,
          device: false,
          chat: false,
        },
      })
    if (path === '/bootstrap')
      return json({ token: 'fixture-token', expiresInSeconds: 3600 })
    if (path === '/collect')
      return route.fulfill({ status: 204, headers: cors })
    if (path.endsWith('/updates'))
      return json({ handledBy: 'agent', waitingForTeam: false, messages: [] })
    if (path === '/conversations/c1')
      return json({
        id: 'c1',
        status: 'open',
        handledBy: 'agent',
        waitingForTeam: false,
        messages: [
          { id: 'm1', role: 'visitor', content: 'Can you frame a big poster?' },
          {
            id: 'm2',
            role: 'assistant',
            content: 'What can I help with?',
            blocks: [blocks.earlier],
          },
          {
            id: 'm3',
            role: 'assistant',
            content: '',
            blocks: [blocks.checklist],
          },
          {
            id: 'm4',
            role: 'assistant',
            content: 'Which size is it?',
            blocks: [blocks.choices],
          },
        ],
      })
    if (path === '/conversations/c1/messages') {
      sent.push(request.postDataJSON() as Record<string, unknown>)
      replies += 1
      const next = [blocks.list, blocks.form, null][replies - 1] ?? null
      const text = [
        'When suits you?',
        'Lovely. Leave your details.',
        'Thanks, Tom.',
      ][replies - 1]
      return route.fulfill({
        headers: { ...cors, 'content-type': 'text/event-stream' },
        body: [
          `event: delta\ndata: ${JSON.stringify({ text })}\n\n`,
          `event: done\ndata: ${JSON.stringify({ messageId: `r${replies}`, citations: [], blocks: next ? [next] : [] })}\n\n`,
        ].join(''),
      })
    }
    return route.fulfill({ status: 404, headers: cors })
  })
  await page.addInitScript(() =>
    localStorage.setItem(
      'anyhour:bot:conversation',
      JSON.stringify({ id: 'c1', resumeToken: 'resume' }),
    ),
  )
  return sent
}

test('chat blocks in the website widget at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const sent = await stubWebsite(page)
  await page.goto(site)
  await page
    .getByRole('button', { name: /Willow/ })
    .first()
    .click()
  const chat = page.getByLabel('Chat with Willow')
  await expect(chat).toContainText('What can I help with?')
  await expect(chat).toContainText('What to bring')
  // Older blocks can't be tapped; the newest can.
  await expect(chat.getByRole('button', { name: 'Framing' })).toBeDisabled()
  await page.screenshot({ path: 'test-results/widget-blocks-mobile.png' })

  await chat.getByRole('button', { name: 'A1' }).click()
  await expect(chat.locator('.wpBotVisitor').last()).toHaveText('A1')
  expect(sent[0]).toMatchObject({
    content: 'A1',
    blockReply: { blockId: 'b_sizes', value: 'A1' },
  })
  await expect(chat.getByRole('button', { name: 'A2' })).toBeDisabled()
  await expect(chat.getByRole('button', { name: /Wed 14:30/ })).toBeEnabled()
  await page.screenshot({ path: 'test-results/widget-blocks-list-mobile.png' })
  await chat.getByRole('button', { name: /Sat 09:00/ }).click()
  expect(sent[1]).toMatchObject({
    blockReply: { blockId: 'b_times', value: 'Sat 09:00' },
  })

  // The contact form: checked in the page, then sent with its block.
  const form = chat.locator('.wpBlockForm')
  await expect(form).toContainText('What’s the best email address')
  await form.getByLabel('Your name').fill('Tom Reed')
  await form.getByLabel('Email').fill('tom@example.com')
  await page.screenshot({ path: 'test-results/widget-blocks-form-mobile.png' })
  await form.getByRole('button', { name: 'Send' }).click()
  await expect(chat).toContainText('Thanks, Tom.')
  expect(sent[2]).toMatchObject({
    blockReply: { blockId: 'b_form', value: 'sent' },
    contact: { name: 'Tom Reed', email: 'tom@example.com' },
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({ path: 'test-results/widget-blocks-sent-mobile.png' })
  expect(errors).toEqual([])
})

test('chat blocks in the inbox, read-only', async ({ page, context }) => {
  const read = async (path: string) =>
    JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')) as never
  const { accounts } = (await read(
    '../../api/.local-test/integration-credentials.json',
  )) as { accounts: { owner: { cookie: string; email: string } } }
  const seeded = (await read('../../api/.local-test/browser-context.json')) as {
    organizationId: string
    widgetConversationId: string
  }
  await context.addCookies(
    accounts.owner.cookie.split(';').map((part) => {
      const separator = part.indexOf('=')
      return {
        name: part.slice(0, separator).trim(),
        value: part.slice(separator + 1).trim(),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax' as const,
      }
    }),
  )
  await page.addInitScript(
    ({ email, workspaceId }) =>
      localStorage.setItem(`anyhour:workspace:${email}`, workspaceId),
    { email: accounts.owner.email, workspaceId: seeded.organizationId },
  )
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`/conversations/${seeded.widgetConversationId}`)
  const pane = page.getByRole('region', { name: 'Conversation' })
  await expect(pane).toContainText('Which size is it?')
  await expect(pane.locator('.transcriptBlock').first()).toContainText('A2')
  await expect(pane).toContainText('Tapped')
  await expect(pane).toContainText('What to bring')
  await expect(pane).toContainText('Contact form: A1 framing quote')
  await expect(pane).toContainText('Sent with the form')
  // Read-only: nothing in a block can be pressed.
  await expect(pane.locator('.transcriptBlock button')).toHaveCount(0)
  await page.screenshot({
    path: 'test-results/inbox-blocks-desktop.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: 'test-results/inbox-blocks-mobile.png',
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  expect(errors).toEqual([])
})

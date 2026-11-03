import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'

interface iAccount {
  cookie: string
  email: string
}

async function credentials() {
  return JSON.parse(
    await readFile(
      new URL(
        '../../api/.local-test/integration-credentials.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { accounts: { owner: iAccount } }
}

async function signIn(context: BrowserContext, account: iAccount) {
  await context.addCookies(
    account.cookie.split(';').map((part) => {
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
}

async function fitsPhone(page: Page, name: string) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: `test-results/${name}-mobile.png`,
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({
    path: `test-results/${name}-desktop.png`,
    fullPage: true,
  })
}

// Channels: the team's chat apps (WhatsApp agents per person and Slack),
// and the "Link your account" page.
test('my tools shows the team chat apps', async ({ page, context }) => {
  const { accounts } = await credentials()
  const fixture = JSON.parse(
    await readFile(
      new URL('../../api/.local-test/browser-context.json', import.meta.url),
      'utf8',
    ),
  ) as { organizationId: string }
  await signIn(context, accounts.owner)
  await page.addInitScript(
    ({ email, organizationId }) => {
      if (window === window.top)
        localStorage.setItem(`anyhour:workspace:${email}`, organizationId)
    },
    { email: accounts.owner.email, organizationId: fixture.organizationId },
  )
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/channels')
  // The owner's agent is listed with its employee; another can be linked.
  const whatsapp = page.locator('section.whatsappCard')
  await expect(
    whatsapp.getByRole('heading', { name: 'WhatsApp' }),
  ).toBeVisible()
  await expect(whatsapp.locator('.toolStatus')).toHaveText('Connected')
  await expect(whatsapp.locator('.agentRow')).toContainText('Willow Studio')
  await expect(whatsapp.getByRole('switch')).toBeVisible()
  // A Slack workspace that stopped working says why and offers a reconnect.
  const slack = page.locator('section.teamChatCard', { hasText: 'Slack' })
  await expect(slack.locator('.toolStatus')).toHaveText('Needs attention')
  await expect(slack).toContainText('token_revoked')
  await expect(
    slack.getByRole('button', { name: 'Reconnect Slack' }),
  ).toBeVisible()
  await fitsPhone(page, 'tools-chat-apps')
  await page.setViewportSize({ width: 390, height: 844 })
  await slack.screenshot({ path: 'test-results/tools-slack-mobile.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })

  // An expired or unknown link says so in one line.
  await page.goto('/link/not-a-real-token')
  await expect(
    page.getByRole('heading', { name: 'Link your account' }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('expired')
  await fitsPhone(page, 'link-account')
  expect(errors).toEqual([])
})

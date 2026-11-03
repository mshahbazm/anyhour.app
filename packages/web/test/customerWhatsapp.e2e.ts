import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'

interface iAccount {
  cookie: string
  email: string
}

async function fixture() {
  const read = async (path: string) =>
    JSON.parse(
      await readFile(new URL(path, import.meta.url), 'utf8'),
    ) as unknown
  return {
    accounts: (
      (await read('../../api/.local-test/integration-credentials.json')) as {
        accounts: { owner: iAccount }
      }
    ).accounts,
    context: (await read('../../api/.local-test/browser-context.json')) as {
      organizationId: string
      whatsappConversationId: string
    },
  }
}

async function signIn(
  page: Page,
  context: BrowserContext,
  account: iAccount,
  organizationId: string,
) {
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
  await page.addInitScript(
    ({ email, workspaceId }) => {
      if (window === window.top)
        localStorage.setItem(`anyhour:workspace:${email}`, workspaceId)
    },
    { email: account.email, workspaceId: organizationId },
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

// Customer WhatsApp: the number on Channels, its conversation in the inbox,
// and a staff reply going out through WhatsApp.
test('customer WhatsApp on Channels and in the inbox', async ({
  page,
  context,
}) => {
  const { accounts, context: seeded } = await fixture()
  await signIn(page, context, accounts.owner, seeded.organizationId)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/channels')
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'WhatsApp Business' }),
  })
  await expect(card.locator('.toolStatus')).toHaveText('Connected')
  await expect(card).toContainText('+44 7700 900000')
  await expect(
    card.getByLabel('Template for replies after 24 hours'),
  ).toBeVisible()
  await fitsPhone(page, 'tools-customer-whatsapp')
  await page.setViewportSize({ width: 390, height: 844 })
  await card.screenshot({
    path: 'test-results/tools-customer-whatsapp-card-mobile.png',
  })
  await page.setViewportSize({ width: 1440, height: 1000 })

  await page.goto('/conversations')
  const row = page.getByRole('button', { name: /Sara Malik/ }).first()
  await expect(row).toBeVisible()
  await expect(row.getByLabel('WhatsApp')).toBeVisible()
  await fitsPhone(page, 'inbox-whatsapp')

  await page.goto(`/conversations/${seeded.whatsappConversationId}`)
  const pane = page.getByRole('region', { name: 'Conversation' })
  await expect(pane).toContainText('WhatsApp')
  await expect(pane).toContainText('Read')
  await pane.getByLabel('Reply to Sara Malik').fill('We can do A0 on Saturday.')
  await pane.getByRole('button', { name: 'Send' }).click()
  await expect(pane.locator('.fromStaff').last()).toContainText('Sent')
  await fitsPhone(page, 'inbox-whatsapp-conversation')

  // Disconnecting brings back the form for pasting a number.
  await page.goto('/channels')
  await card.getByRole('button', { name: 'Disconnect' }).click()
  await card.getByRole('button', { name: 'Yes, disconnect' }).click()
  await expect(card.locator('.toolStatus')).toHaveText('Not connected')
  await expect(card.getByLabel('Phone number id')).toBeVisible()
  await expect(card.getByLabel('Access token')).toHaveAttribute(
    'type',
    'password',
  )
  await fitsPhone(page, 'tools-customer-whatsapp-connect')
  await page.setViewportSize({ width: 390, height: 844 })
  await card.screenshot({
    path: 'test-results/tools-customer-whatsapp-connect-card-mobile.png',
  })
  expect(errors).toEqual([])
})

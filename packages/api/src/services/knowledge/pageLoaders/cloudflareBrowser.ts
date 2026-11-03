import { knowledgeConfig } from '../../../config/knowledge.config'
import puppeteer, {
  TimeoutError,
  type Browser,
  type Page,
} from 'puppeteer-core'
import type { iPageLoader } from './types'
import {
  cloudflareAccount,
  cloudflareApi,
  cloudflareConfigured,
} from './cloudflare'

// A real browser at Cloudflare (Browser Run), kept open between pages: it
// runs a site's scripts and doesn't check robots.txt.
const maxTabs = knowledgeConfig.pagesAtOnce
const pageTimeoutMs = 30_000
// An open browser is billed, so one left idle is closed.
const idleCloseMs = 60_000

// One browser per process, connected on first use and again after it drops.
let browser: Promise<Browser> | undefined
let openTabs = 0
const waiting: Array<() => void> = []
let idleTimer: ReturnType<typeof setTimeout> | undefined

function sharedBrowser() {
  if (!browser) {
    const { accountId, token } = cloudflareAccount()
    const connecting = puppeteer
      .connect({
        browserWSEndpoint: `wss://${cloudflareApi}/${accountId}/browser-run/devtools/browser?keep_alive=600000`,
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((connected) => {
        connected.once('disconnected', () => {
          if (browser === connecting) browser = undefined
        })
        return connected
      })
      // Its error names the account in the address; say only what happened.
      .catch(() => {
        throw new Error('The browser session could not start')
      })
    connecting.catch(() => {
      if (browser === connecting) browser = undefined
    })
    browser = connecting
  }
  return browser
}

async function closeBrowser() {
  clearTimeout(idleTimer)
  const current = browser
  browser = undefined
  await current?.then((connected) => connected.close()).catch(() => undefined)
}

async function takeTab() {
  while (openTabs >= maxTabs)
    await new Promise<void>((resolve) => waiting.push(resolve))
  openTabs += 1
  clearTimeout(idleTimer)
}

function releaseTab() {
  openTabs -= 1
  waiting.shift()?.()
  if (!openTabs) {
    idleTimer = setTimeout(() => {
      if (!openTabs) void closeBrowser()
    }, idleCloseMs)
    idleTimer.unref?.()
  }
}

async function readContent(tab: Page) {
  try {
    return await tab.content()
  } catch {
    // "Cannot find context": the page navigated while being read.
    await Bun.sleep(1000)
    return tab.content()
  }
}

export const cloudflareBrowser: iPageLoader = {
  name: 'cloudflareBrowser',
  configured: cloudflareConfigured,
  close: closeBrowser,
  async load(url) {
    await takeTab()
    let tab: Page | undefined
    try {
      tab = await (await sharedBrowser()).newPage()
      // A page that keeps loading is read as far as it got.
      const response = await tab
        .goto(url, { waitUntil: 'networkidle2', timeout: pageTimeoutMs })
        .catch((error: unknown) => {
          if (error instanceof TimeoutError) return null
          throw error
        })
      const loadedUrl = tab.url()
      if (!/^https?:/.test(loadedUrl)) throw new Error('Browser loaded no page')
      return {
        url: loadedUrl,
        status: response?.status() ?? 200,
        html: await readContent(tab),
        loadedBy: 'cloudflareBrowser',
      }
    } finally {
      await tab?.close().catch(() => undefined)
      releaseTab()
    }
  },
}

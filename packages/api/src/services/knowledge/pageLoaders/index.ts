import { knowledgeConfig } from '../../../config/knowledge.config'
import { isBlockedPage } from './blocked'
import { cloudflareBrowser } from './cloudflareBrowser'
import { cloudflareContent } from './cloudflareContent'
import {
  PageBlockedError,
  type iLoadedPage,
  type iPageLoader,
  type tPageLoaderName,
} from './types'

export { isBlockedPage } from './blocked'
export { PageBlockedError, type iLoadedPage } from './types'

const loaders: Record<tPageLoaderName, iPageLoader> = {
  cloudflareBrowser,
  cloudflareContent,
}

function configuredLoaders() {
  return knowledgeConfig.pageLoaders
    .map((name) => loaders[name])
    .filter((loader) => loader.configured())
}

/** Whether any loader is set up; without one, pages are read plainly. */
export function pageLoadersConfigured() {
  return configuredLoaders().length > 0
}

export class PageNotFoundError extends Error {
  constructor(readonly status: 404 | 410) {
    super(`Page returned HTTP ${status}`)
  }
}

/**
 * The page as a browser shows it, from the first configured loader that
 * returns it. A bot-protection page counts as a failure; when that is all
 * any loader got, PageBlockedError. A missing page (404/410) stops at once.
 */
export async function loadPage(url: string): Promise<iLoadedPage> {
  let failure: unknown = new Error('No page loader is configured')
  let blocked = false
  for (const loader of configuredLoaders()) {
    let page: iLoadedPage
    try {
      page = await loader.load(url)
    } catch (error) {
      failure = error
      continue
    }
    if (page.status === 404 || page.status === 410)
      throw new PageNotFoundError(page.status)
    if (isBlockedPage(page.html, page.status)) {
      blocked = true
      continue
    }
    if (page.status >= 400) {
      failure = new Error(`Page returned HTTP ${page.status}`)
      continue
    }
    return page
  }
  throw blocked ? new PageBlockedError() : failure
}

/** For scripts: closes kept-open sessions so the process can exit. */
export async function closePageLoaders() {
  await Promise.all(Object.values(loaders).map((loader) => loader.close?.()))
}

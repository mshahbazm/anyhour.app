// A page loader turns an address into the HTML a visitor would see. Each
// provider is one file in this folder and one name here; the order they are
// tried in is `pageLoaders` in config/knowledge.config.ts.
export type tPageLoaderName = 'cloudflareBrowser' | 'cloudflareContent'

export interface iLoadedPage {
  /** Where the page ended up, after redirects. */
  url: string
  status: number
  html: string
  loadedBy: string
}

export interface iPageLoader {
  name: tPageLoaderName
  /** False when its keys aren't set: it is skipped. */
  configured(): boolean
  /** Throws when the page can't be loaded. */
  load(url: string): Promise<iLoadedPage>
  /** Lets go of anything kept open between pages. */
  close?(): Promise<void>
}

// Bot protection turned every way of loading the page away. Trying again
// soon won't change that, so the page fails at once.
export class PageBlockedError extends Error {
  constructor() {
    super('The website blocked reading this page')
  }
}

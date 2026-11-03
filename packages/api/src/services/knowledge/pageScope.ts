import { isSameWebsite, normalizeUrl, pathAllowed } from './web'

export interface iPageScope {
  inputUrl: string
  includePaths: string[]
  excludePaths: string[]
}

export class PageScopeError extends Error {}

// Source identity and the resolved evidence location must both satisfy scope.
// Do not return the normalized URL: its trailing slash affects relative links.
export function assertPageScope(scope: iPageScope, url: string) {
  normalizeUrl(url)
  if (!isSameWebsite(scope.inputUrl, url))
    throw new PageScopeError('Page redirected outside the website')
  if (!pathAllowed(url, scope.includePaths, scope.excludePaths))
    throw new PageScopeError('Page is outside the website path settings')
}

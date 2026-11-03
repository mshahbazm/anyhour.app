import type { iPageLoader } from './types'
import {
  cloudflareAccount,
  cloudflareApi,
  cloudflareConfigured,
} from './cloudflare'

// Cloudflare's one-page tool: a fresh browser for a single page. It reports
// neither the status nor where the page ended up.
export const cloudflareContent: iPageLoader = {
  name: 'cloudflareContent',
  configured: cloudflareConfigured,
  async load(url) {
    const { accountId, token } = cloudflareAccount()
    const response = await fetch(
      `https://${cloudflareApi}/${accountId}/browser-run/content`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(60_000),
      },
    )
    if (!response.ok)
      throw new Error(`Browser Run returned HTTP ${response.status}`)
    const value: unknown = await response.json()
    if (
      !value ||
      typeof value !== 'object' ||
      !('success' in value) ||
      value.success !== true ||
      !('result' in value) ||
      typeof value.result !== 'string'
    )
      throw new Error('Browser Run returned an invalid response')
    return {
      url,
      status: 200,
      html: value.result,
      loadedBy: 'cloudflareContent',
    }
  },
}

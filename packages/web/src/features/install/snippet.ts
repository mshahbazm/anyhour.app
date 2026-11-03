import { apiOrigin, widgetOrigin } from '../workspace/api'

/** The install code, one attribute per line so it reads clearly and pastes
 * as-is. It names the website channel when there is one, else the AI. */
export function embedSnippet(input: { botId: string; siteId?: string | null }) {
  return [
    '<script',
    `  src="${widgetOrigin}/embed.js"`,
    input.siteId
      ? `  data-site="${input.siteId}"`
      : `  data-bot="${input.botId}"`,
    `  data-api="${apiOrigin}"`,
    '  async',
    '></script>',
  ].join('\n')
}

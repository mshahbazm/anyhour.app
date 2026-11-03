import { env } from '../../../env'

// Cloudflare Browser Run, shared by its two loaders.
export const cloudflareApi = 'api.cloudflare.com/client/v4/accounts'

export function cloudflareConfigured() {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN)
}

export const cloudflareAccount = () => ({
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
  token: env.CLOUDFLARE_API_TOKEN,
})

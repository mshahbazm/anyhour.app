import { createAuthClient } from 'better-auth/react'
import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  fetchOptions: { credentials: 'include' },
  plugins: [magicLinkClient(), organizationClient()],
})

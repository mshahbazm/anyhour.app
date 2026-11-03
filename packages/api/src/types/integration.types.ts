// HTTP contracts for workspace API keys and the public API.

export interface iApiKey {
  id: string
  name: string
  keyPrefix: string
  lastUsedAt: string | null
  createdAt: string
}

// Only the create response carries the full key.
export interface iCreatedApiKey extends iApiKey {
  key: string
}

export interface iApiKeyList {
  apiKeys: iApiKey[]
}

// GET /api/v1/me: the workspace an API key belongs to.
export interface iApiKeyIdentity {
  organizationId: string
  organizationName: string
}

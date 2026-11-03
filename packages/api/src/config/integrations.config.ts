// Workspace API keys (the WordPress plugin's site sync).
export const apiKeyConfig = {
  prefix: 'wp_live_',
  // Characters of the key kept in clear so owners can tell keys apart.
  visiblePrefixLength: 12,
  maxActivePerWorkspace: 20,
  // lastUsedAt is written at most this often per key.
  touchIntervalSeconds: 60,
} as const

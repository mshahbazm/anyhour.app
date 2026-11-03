import { decryptSecret, encryptSecret } from '../whatsapp/secret'

// A connection's credentials (e.g. Slack's bot token) as encrypted JSON,
// with the same key handling as WhatsApp agent keys. Never logged, never
// returned to a client.

export function sealCredentials(value: Record<string, string>) {
  return encryptSecret(JSON.stringify(value))
}

// Null when there are none, or they can't be read (the secret changed).
export function openCredentials(
  stored: string | null,
): Record<string, string> | null {
  if (!stored) return null
  const text = decryptSecret(stored)
  if (text === null) return null
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === 'object'
      ? (value as Record<string, string>)
      : null
  } catch {
    return null
  }
}

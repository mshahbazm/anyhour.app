import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto'
import { env } from '../../env'

// Secrets at rest (WhatsApp agent keys, connection credentials):
// AES-256-GCM with a key derived (HKDF) from BETTER_AUTH_SECRET, so no new
// secret is needed. Rotating BETTER_AUTH_SECRET makes stored keys
// unreadable; the agent or connection then shows as broken and is connected
// again.

const version = 'v1'
let keys: { cipher: Buffer; fingerprint: Buffer } | undefined

function derived() {
  keys ??= {
    cipher: Buffer.from(
      hkdfSync(
        'sha256',
        env.BETTER_AUTH_SECRET,
        'anyhour',
        'whatsapp-agent-token',
        32,
      ),
    ),
    fingerprint: Buffer.from(
      hkdfSync(
        'sha256',
        env.BETTER_AUTH_SECRET,
        'anyhour',
        'whatsapp-agent-fingerprint',
        32,
      ),
    ),
  }
  return keys
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', derived().cipher, iv)
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [
    version,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    data.toString('base64url'),
  ].join(':')
}

// Null when the value can't be read (tampered, or the secret changed).
export function decryptSecret(stored: string): string | null {
  const [tag, iv, auth, data] = stored.split(':')
  if (tag !== version || !iv || !auth || data === undefined) return null
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      derived().cipher,
      Buffer.from(iv, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(auth, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

// A keyed hash that identifies a key without storing it in clear.
export function secretFingerprint(value: string) {
  return createHmac('sha256', derived().fingerprint)
    .update(value)
    .digest('base64url')
}

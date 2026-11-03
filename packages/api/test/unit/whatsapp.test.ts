import { expect, test } from 'bun:test'
import { isStale } from '../../src/services/whatsapp/ownerMessage'
import {
  decryptSecret,
  encryptSecret,
  secretFingerprint,
} from '../../src/services/whatsapp/secret'

test('owner messages older than 15 minutes, or from the future, are stale', () => {
  const now = Date.now()
  const at = (ms: number) => ({
    from: 'user:1',
    id: 'x',
    type: 'text',
    timestamp: String(Math.floor(ms / 1000)),
  })
  expect(isStale(at(now - 60_000), now)).toBe(false)
  expect(isStale(at(now - 16 * 60_000), now)).toBe(true)
  expect(isStale(at(now + 5 * 60_000), now)).toBe(true)
  expect(isStale({ ...at(now), timestamp: 'soon' }, now)).toBe(true)
})

test('agent keys are encrypted at rest and tamper-evident', () => {
  const stored = encryptSecret('agent-key-123')
  expect(stored).not.toContain('agent-key-123')
  expect(encryptSecret('agent-key-123')).not.toBe(stored)
  expect(decryptSecret(stored)).toBe('agent-key-123')
  const parts = stored.split(':')
  parts[3] = Buffer.from('other').toString('base64url')
  expect(decryptSecret(parts.join(':'))).toBeNull()
  expect(decryptSecret('garbage')).toBeNull()
  expect(secretFingerprint('agent-key-123')).toBe(
    secretFingerprint('agent-key-123'),
  )
  expect(secretFingerprint('agent-key-123')).not.toBe(secretFingerprint('x'))
})

import { timingSafeEqual } from 'node:crypto'
import { teamChatConfig } from '../../config/teamChat.config'
import type { tConnectionProvider } from '../../db/schema/product/connection'
import { ApiError } from '../http/apiError'
import { secretFingerprint } from '../whatsapp/secret'

// The OAuth `state` for installing our app: who started it, for which
// workspace and employee, signed and short-lived, so a callback can't be
// forged or replayed later.

export interface iInstallState {
  provider: tConnectionProvider
  organizationId: string
  memberId: string
  assistantId: string | null
  expiresAt: number
}

const sign = (payload: string) => secretFingerprint(`install-state:${payload}`)

export function createInstallState(input: Omit<iInstallState, 'expiresAt'>) {
  const payload = Buffer.from(
    JSON.stringify({
      ...input,
      expiresAt: Date.now() + teamChatConfig.installStateMinutes * 60_000,
    }),
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function readInstallState(
  value: string | undefined,
  provider: tConnectionProvider,
): iInstallState {
  const invalid = new ApiError(
    400,
    'install_state_invalid',
    'This install link has expired. Start again from the Channels page.',
  )
  const [payload, signature] = (value ?? '').split('.')
  if (!payload || !signature) throw invalid
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    throw invalid
  let state: iInstallState
  try {
    state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    throw invalid
  }
  if (state.provider !== provider || state.expiresAt < Date.now()) throw invalid
  return state
}

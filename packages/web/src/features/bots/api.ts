import { api } from '../workspace/api'
import type { iAssistant } from '../workspace/types'
import type { tPictureStyle } from './pictureStyles'

function aiPath(organizationId: string, assistantId: string) {
  return `/api/organizations/${encodeURIComponent(organizationId)}/assistants/${encodeURIComponent(assistantId)}`
}

/** Saves some of the AI's settings and returns it as saved. */
export function updateAssistant(
  organizationId: string,
  assistantId: string,
  changes: Partial<iAssistant>,
) {
  return api<iAssistant>(aiPath(organizationId, assistantId), {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
}

export function createBotPicture(
  organizationId: string,
  assistantId: string,
  input: { style: tPictureStyle | null; description: string | null },
) {
  return api<iAssistant>(`${aiPath(organizationId, assistantId)}/picture`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

import { ApiError } from '../http/apiError'
import { findWorkspaceAi } from '../assistants/workspaceAi'

/** The workspace's AI, when the address names it; any other id is missing. */
export async function ownedAssistant(
  organizationId: string,
  assistantId: string,
) {
  const record = await findWorkspaceAi(organizationId)
  if (!record || record.id !== assistantId)
    throw new ApiError(404, 'assistant_missing', 'Assistant not found')
  return record
}

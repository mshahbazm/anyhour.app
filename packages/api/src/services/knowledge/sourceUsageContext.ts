import type { iKnowledgeOwner } from './owner'

// Reading knowledge is billed to the workspace.
export function sourceUsageContext(owner: iKnowledgeOwner, sourceId: string) {
  return {
    organizationId: owner.organizationId,
    ...(sourceId ? { sourceId } : {}),
  }
}

import type { tPublicBlock } from '../services/workspaceAgent/uiBlocks'
export type tApiDispatch = (request: Request) => Response | Promise<Response>
export type tWorkspaceEvent =
  | { type: 'started'; messageId: string }
  | { type: 'block'; block: tPublicBlock }
  | { type: 'delta'; text: string }
  | {
      type: 'activity'
      id: string
      name: string
      status: 'running' | 'completed' | 'failed' | 'unknown'
    }
  | {
      type: 'context'
      organizationId: string | null
      assistantId: string | null
    }
  | { type: 'source'; sourceId: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; code: string; message: string }

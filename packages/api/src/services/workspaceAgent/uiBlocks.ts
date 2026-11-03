import { db } from '../../db'
import { workspaceUiBlock } from '../../db/schema'
import type { iPendingNote } from '../../db/schema/product/workspaceUiBlock'
import { workspaceBlockSchema } from '../../schemas/workspaceUi.schema'
import type { tWorkspaceUi } from '../../schemas/workspaceUi.schema'
import { blockNote } from './cards'
import type { iWorkspaceToolContext } from './tools'

export function publicBlock(row: typeof workspaceUiBlock.$inferSelect) {
  return {
    id: row.id,
    messageId: row.messageId,
    payload: row.payload,
    status: row.status,
    resolvedValue: row.resolvedValue,
  }
}
export type tPublicBlock = ReturnType<typeof publicBlock>

export async function createUiBlock(
  ctx: iWorkspaceToolContext,
  payload: tWorkspaceUi,
  removal?: { memberId: string; role: string },
  pendingNote?: iPendingNote,
) {
  const isQuestion = 'options' in payload && payload.type !== 'summary'
  const [row] = await db
    .insert(workspaceUiBlock)
    .values({
      chatId: ctx.chatId,
      messageId: ctx.messageId,
      payload: workspaceBlockSchema.parse(payload),
      // Summaries and cards aren't questions, so nothing waits on them.
      status: isQuestion ? 'pending' : 'resolved',
      removalMemberId: removal?.memberId,
      removalRole: removal?.role,
      pendingNote,
    })
    .returning()
  const block = publicBlock(row)
  ctx.emit({ type: 'block', block })
  return {
    block,
    message: blockNote(payload),
  }
}

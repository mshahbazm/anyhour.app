import { db } from '../../db'
import { workspaceUiBlock } from '../../db/schema'
import { confirmFirstTools } from '../../config/teamChat.config'
import type { iWorkspaceToolContext } from './tools'

const clipped = (value: unknown, limit = 300) => {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

// A held action: the member sees a confirmation (buttons, or "reply yes") and
// only that runs it, from the stored input, before the next turn's model call
// (applyConfirmedAction). Chat apps hold every tool in confirmFirstTools; a
// tool may also hold itself with its own question (`rule`).
export async function holdForConfirmation(
  ctx: iWorkspaceToolContext,
  name: string,
  input: Record<string, unknown>,
  rule: {
    title: string
    description?: string | null
    labels?: { confirm: string; cancel: string }
  } = {
    title: confirmFirstTools[name].title,
    description: clipped(confirmFirstTools[name].detail?.(input)),
  },
) {
  const [row] = await db
    .insert(workspaceUiBlock)
    .values({
      chatId: ctx.chatId,
      messageId: ctx.messageId,
      payload: {
        type: 'confirmation',
        title: rule.title,
        description: clipped(rule.description),
        options: [
          {
            value: 'confirm',
            label: rule.labels?.confirm ?? 'Yes',
            description: null,
          },
          {
            value: 'cancel',
            label: rule.labels?.cancel ?? 'Cancel',
            description: null,
          },
        ],
        items: [],
      },
      status: 'pending',
      pendingAction: { name, input },
    })
    .returning()
  ctx.emit({
    type: 'block',
    block: {
      id: row.id,
      messageId: row.messageId,
      payload: row.payload,
      status: row.status,
      resolvedValue: row.resolvedValue,
    },
  })
  return {
    notDoneYet: true,
    confirmationId: row.id,
    message:
      'Not done yet: this needs the user’s confirmation, which is now shown to them. End this turn with at most one short sentence; don’t list the options. It runs only if they confirm.',
  }
}

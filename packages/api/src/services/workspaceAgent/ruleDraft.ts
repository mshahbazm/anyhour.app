import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { workspaceUiBlock } from '../../db/schema'
import type { tMemberRuleInput } from '../../schemas/memberRule.schema'
import type {
  tRuleDraftAction,
  tRuleDraftCard,
} from '../../schemas/workspaceUi.schema'
import { requirePermission } from '../auth/authorize'
import { ApiError } from '../http/apiError'
import { createMemberRules } from '../memberRules/rules'
import { ownedChat } from './store'
import { publicBlock } from './uiBlocks'

// The card's drafts as rules to save.
function toInput(rule: tRuleDraftCard['rules'][number]): tMemberRuleInput {
  return rule.kind === 'steps'
    ? {
        kind: 'steps',
        text: rule.text,
        when: rule.when ?? rule.text,
        steps: rule.steps ?? [],
        tag: null,
      }
    : {
        kind: 'rule',
        text: rule.text,
        tag: rule.tag,
      }
}

// A tap on the drafted rules card (docs/yourAi.md, "Rules"): Save adds them
// to the AI's rules, once; Not now only changes the card. Returns the
// updated block.
export async function actOnRuleDraft(
  headers: Headers,
  chatId: string,
  blockId: string,
  input: tRuleDraftAction,
) {
  const chat = await ownedChat(headers, chatId)
  if (!chat.organizationId)
    throw new ApiError(404, 'block_missing', 'Card not found')
  const organizationId = chat.organizationId
  await requirePermission(headers, organizationId, 'assistant', 'update')
  const row = await db.transaction(async (tx) => {
    // Locked, so tapping Save twice saves them once.
    const [block] = await tx
      .select()
      .from(workspaceUiBlock)
      .where(
        and(
          eq(workspaceUiBlock.id, blockId),
          eq(workspaceUiBlock.chatId, chat.id),
        ),
      )
      .for('update')
    if (block?.payload.type !== 'ruleDraft')
      throw new ApiError(404, 'block_missing', 'Card not found')
    if (block.payload.status !== 'proposed') return block
    if (input.action === 'save')
      await createMemberRules(
        organizationId,
        block.payload.rules.map(toInput),
        tx,
      )
    const payload: tRuleDraftCard = {
      ...block.payload,
      status: input.action === 'save' ? 'saved' : 'dismissed',
    }
    const [updated] = await tx
      .update(workspaceUiBlock)
      .set({ payload })
      .where(eq(workspaceUiBlock.id, block.id))
      .returning()
    return updated
  })
  return publicBlock(row)
}

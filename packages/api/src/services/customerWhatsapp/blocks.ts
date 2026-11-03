import type { db } from '../../db'
import type { tChatBlock } from '../../schemas/chatBlock.schema'
import { blockReplyText, findBlock } from '../chat/blocks'

// The AI's chat UI blocks on WhatsApp (Cloud API interactive
// messages): choices become reply buttons (up to 3) and lists a list message
// (up to 10 rows). Checklists and contact forms are numbered or plain text.
// Only inside the 24-hour window; after it, the reply follows the usual
// template rules.

// WhatsApp's limit for an interactive message's body.
const bodyChars = 1_024

export type tWhatsappInteractive =
  | {
      type: 'button'
      body: { text: string }
      action: {
        buttons: Array<{ type: 'reply'; reply: { id: string; title: string } }>
      }
    }
  | {
      type: 'list'
      body: { text: string }
      action: {
        button: string
        sections: Array<{
          rows: Array<{ id: string; title: string; description?: string }>
        }>
      }
    }

export type tWhatsappReply =
  | { type: 'text'; text: string }
  | { type: 'interactive'; interactive: tWhatsappInteractive }

// A tap comes back with the id we gave the button or row.
const replyId = (blockId: string, value: string) => `wp:${blockId}:${value}`

/**
 * What a reply looks like on WhatsApp, interactive where a block fits.
 * `text` is the reply already made plain (send.ts plainText).
 */
export function whatsappReply(
  text: string,
  blocks: tChatBlock[],
): tWhatsappReply {
  const block = blocks[0]
  const withFallback = block
    ? [text, block.fallback].filter(Boolean).join('\n\n')
    : text
  if (!block) return { type: 'text', text }
  // Interactive messages need a body; ours is the reply itself.
  const body = text || 'Choose one:'
  if (block.kind === 'choices' && body.length <= bodyChars)
    return {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: block.options.map((item, index) => ({
            type: 'reply',
            reply: { id: replyId(block.id, String(index)), title: item.label },
          })),
        },
      },
    }
  if (block.kind === 'list' && body.length <= bodyChars)
    return {
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: block.buttonLabel,
          sections: [
            {
              rows: block.options.map((item, index) => ({
                id: replyId(block.id, String(index)),
                title: item.label,
                ...(item.description ? { description: item.description } : {}),
              })),
            },
          ],
        },
      },
    }
  return { type: 'text', text: withFallback }
}

/**
 * The visitor's tap for a button or list row id we sent in this
 * conversation, with the text it reads as; null for anything else.
 */
export async function tappedBlock(
  executor: Pick<typeof db, 'select'>,
  conversationId: string,
  id: string | undefined,
) {
  const match = id && /^wp:([\w-]{1,64}):(\w{1,8})$/.exec(id)
  if (!match) return null
  const [, blockId, key] = match
  const block = await findBlock(executor, conversationId, blockId)
  const value =
    block?.kind === 'choices' || block?.kind === 'list'
      ? block.options[Number(key)]?.value
      : undefined
  const text = block && value ? blockReplyText(block, value) : null
  return text && value ? { blockReply: { blockId, value }, text } : null
}

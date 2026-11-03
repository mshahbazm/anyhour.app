import type { tWorkspaceUi } from '../../schemas/workspaceUi.schema'

// What the agent is told after it shows a block in the chat. Every block
// gets its note from here, in the same shape, so the agent talks around all
// of them the same way (systemPrompt.ts, "Cards"): one line above, never a
// repeat, and a "yes" typed in the chat does what the card's button does.
//
// Adding a card: add its payload to schemas/workspaceUi.schema.ts, its note
// to blockNote below (TypeScript asks for it), and its view in the web package's
// features/workspace/chatBlock.tsx.

interface iCardAsk {
  /** The question shown under the card, if it asks one. */
  asks?: string
  /** The card's main button. */
  button: string
  /** What the agent does when the owner says yes in the chat instead. */
  onYes: string
}

function asking(card: iCardAsk) {
  const question = card.asks ? `asks "${card.asks}" and ` : ''
  return `Card shown. It ${question}has a "${card.button}" button. Don't repeat the card or ask again. If the owner says yes in the chat, ${card.onYes}.`
}

// The return type makes a new block type a compile error until it has a note.
export function blockNote(payload: tWorkspaceUi): string {
  switch (payload.type) {
    case 'summary':
      return 'Summary displayed.'
    case 'choice':
    case 'actions':
    case 'confirmation':
      return 'Choices displayed. End this turn and wait for the user. Do not choose an option yourself.'
    case 'ruleDraft':
      return payload.status === 'proposed'
        ? asking({
            button: 'Save',
            onYes: 'call save_member_rules with this card’s blockId',
          })
        : 'Card shown; already decided. Don’t repeat the card.'
  }
}

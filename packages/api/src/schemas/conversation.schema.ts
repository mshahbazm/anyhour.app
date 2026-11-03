import { z } from 'zod'

// A team member's reply to the visitor, sent as a staff message.
// noteOfferIn: where the AI offers to remember the answer — a card in the
// inbox (kept on the reply), or the AI's chat the reply came through (only
// returned).
export const staffReplySchema = z.object({
  content: z.string().trim().min(1).max(4000),
  noteOfferIn: z.enum(['inbox', 'chat']).default('inbox'),
})

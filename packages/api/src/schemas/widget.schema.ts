import { z } from 'zod'
import { blockContactSchema, blockReplySchema } from './chatBlock.schema'

export const createConversationSchema = z.object({
  entryUrl: z.url().optional(),
})
export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  clientMessageId: z.string().min(8).max(128),
  // A tap on one of the AI's blocks, or its contact form.
  blockReply: blockReplySchema.optional(),
  contact: blockContactSchema.optional(),
})

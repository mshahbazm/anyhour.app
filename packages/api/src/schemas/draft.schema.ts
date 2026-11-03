import { z } from 'zod'

// The owner's own words, for an endpoint that drafts records from them.
export const draftTextSchema = z.object({
  text: z.string().trim().min(1).max(4000),
})

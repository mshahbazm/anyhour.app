import { z } from 'zod'

// The agent's API key from WhatsApp (chat info → API key). Opaque: only its
// length and that it is one line are checked here; WhatsApp checks the rest.
export const connectWhatsappSchema = z.object({
  token: z
    .string()
    .trim()
    .min(8)
    .max(2_000)
    .regex(/^\S+$/, 'The key is one word without spaces'),
})

export type tConnectWhatsappInput = z.infer<typeof connectWhatsappSchema>

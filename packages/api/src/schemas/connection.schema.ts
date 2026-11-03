import { z } from 'zod'

export const updateConnectionSchema = z
  .object({
    // Null sends alerts to each linked member directly.
    alertsChannelId: z.string().min(1).max(64).nullable().optional(),
    // WhatsApp Business: the approved template (name as in Meta, one body
    // variable) for replies after 24 hours; null or empty removes it.
    templateName: z
      .string()
      .trim()
      .max(512)
      .regex(/^[a-z0-9_]*$/, 'Use the template name as Meta shows it')
      .nullable()
      .optional(),
    templateLanguage: z
      .string()
      .trim()
      .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'Use a language code such as en_US')
      .optional(),
  })
  .refine(
    (value) =>
      value.alertsChannelId !== undefined || value.templateName !== undefined,
    'Nothing to change',
  )

export type tUpdateConnectionInput = z.infer<typeof updateConnectionSchema>

// The business's WhatsApp number, pasted from Meta's WhatsApp Manager.
export const connectWhatsappBusinessSchema = z.object({
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{5,30}$/, 'Paste the phone number id'),
  businessAccountId: z
    .string()
    .trim()
    .regex(/^\d{5,30}$/, 'Paste the WhatsApp Business Account id'),
  accessToken: z.string().trim().min(20).max(1024),
})

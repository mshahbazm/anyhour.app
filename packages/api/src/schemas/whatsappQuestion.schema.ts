import { z } from 'zod'
import {
  whatsappApproaches,
  whatsappQuestionLimits,
} from '../config/whatsappQuestion.config'

// PUT .../assistants/:id/whatsapp-question. A number, when given, is
// normalised by the service (a clear message when it isn't one) and saved
// to Your business as a fact; `custom` keeps the rule as is.
export const saveWhatsappQuestionSchema = z.object({
  question: z.string().trim().min(1).max(whatsappQuestionLimits.questionLength),
  number: z.string().trim().min(1).max(200).optional(),
  approach: z.enum([...whatsappApproaches, 'custom']),
})
export type tSaveWhatsappQuestion = z.infer<typeof saveWhatsappQuestionSchema>

// The widget's open call: which WhatsApp button the visitor opened.
export const whatsappOpenSchema = z.object({
  blockId: z.string().min(1).max(64),
})

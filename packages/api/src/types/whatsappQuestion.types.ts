// HTTP contracts for the WhatsApp question (docs/whatsappQuestion.md).
import type {
  iWhatsappQuestion,
  tWhatsappApproach,
} from '../config/whatsappQuestion.config'

export type { tWhatsappApproach }

/** `custom`: its rule was deleted or changed elsewhere (in chat). */
export type tOwnerWhatsappApproach = tWhatsappApproach | 'custom'

// Owner GET .../assistants/:id `appearance.whatsapp`, and PUT
// .../assistants/:id/whatsapp-question.
export interface iOwnerWhatsappQuestion extends Omit<
  iWhatsappQuestion,
  'approach'
> {
  approach: tOwnerWhatsappApproach
}

// GET .../assistants/:id/whatsapp-question/number
export interface iWhatsappNumberLookup {
  number: string | null
  source: 'channel' | 'knowledge' | null
}

// The launcher config and chat config: never the number.
export interface iPublicWhatsappQuestion {
  question: string
}

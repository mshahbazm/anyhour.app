// HTTP contracts for the WhatsApp question (docs/whatsappQuestion.md).
import type {
  iWhatsappQuestion,
  tWhatsappApproach,
} from '../config/whatsappQuestion.config'

export type { tWhatsappApproach }

/** `custom`: its rule was deleted or changed elsewhere (in chat). */
export type tOwnerWhatsappApproach = tWhatsappApproach | 'custom'

/** Where the WhatsApp number comes from: the WhatsApp channel, or Your business. */
export type tWhatsappNumberSource = 'channel' | 'note' | 'website'

// GET .../assistants/:id/whatsapp-question/number
export interface iWhatsappNumberLookup {
  /** Digits with the country code. */
  number: string | null
  source: tWhatsappNumberSource | null
}

// Owner GET .../assistants/:id `appearance.whatsapp`, and PUT
// .../assistants/:id/whatsapp-question. The number is read only: from the
// WhatsApp channel, else the contact details in Your business.
export interface iOwnerWhatsappQuestion extends Omit<
  iWhatsappQuestion,
  'approach'
> {
  approach: tOwnerWhatsappApproach
  number: string | null
  numberSource: tWhatsappNumberSource | null
}

// The launcher config and chat config: never the number.
export interface iPublicWhatsappQuestion {
  question: string
}

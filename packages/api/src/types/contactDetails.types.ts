// A business's contact details (docs/glossary.md, "Contact details"): read
// from Your business like its opening hours, never typed into a form.

export const contactFields = ['whatsapp', 'phone', 'email', 'address'] as const
export type tContactField = (typeof contactFields)[number]

export interface iContactDetail {
  /** WhatsApp and phone: digits with the country code; email lowercased; address one line. */
  value: string
  source: 'note' | 'website'
  /** The knowledge_source it came from. */
  sourceId: string | null
}

export interface iContactDetails {
  whatsapp: iContactDetail | null
  phone: iContactDetail | null
  email: iContactDetail | null
  address: iContactDetail | null
}

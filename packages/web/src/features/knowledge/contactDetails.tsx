import { Contact } from 'lucide-react'

// Mirrors iContactDetails in packages/api/src/types/contactDetails.types.ts.
export interface iContactDetail {
  value: string
  source: 'note' | 'website'
  sourceId: string | null
}
export interface iContactDetails {
  whatsapp: iContactDetail | null
  phone: iContactDetail | null
  email: iContactDetail | null
  address: iContactDetail | null
}

// One quiet line next to the opening hours. Contact details are read from
// what the AI knows; changing them is telling a fact, never a form.
export function ContactDetails(props: { details: iContactDetails | null }) {
  const details = props.details
  if (!details) return null
  const found = [
    details.whatsapp && `WhatsApp +${details.whatsapp.value}`,
    details.phone && `Phone ${details.phone.value}`,
    details.email?.value,
    details.address?.value,
  ].filter((item): item is string => Boolean(item))
  if (!found.length) return null
  return (
    <p className="openingHours">
      <Contact size={14} aria-hidden="true" />
      <span>Contact details: {found.join(' · ')}</span>
    </p>
  )
}

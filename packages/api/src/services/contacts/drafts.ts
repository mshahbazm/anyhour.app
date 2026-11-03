import { z } from 'zod'
import { contactMemory } from '../../config/contacts.config'
import type { iContactDrafts } from '../../types/contact.types'
import type { iDraftMissing } from '../../types/draft.types'
import { draftFromText } from '../ai/draftFromText'
import { cleanFacts } from './memory'
import { normalizeEmail, normalizePhone } from './identities'

const draftSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  facts: z.array(z.string()),
})

export const contactDraftInstructions = `Return exactly one record: the person the owner describes, someone the business can reach.
- name: the person's name as written; null if not given.
- email and phone: copied exactly as written; null if not given. Never add or change a country code.
- facts: up to ${contactMemory.factsPerConversation} short, durable facts about the person that will still be useful next time ("Wants a new website.", "Prefers calls in the evening."), each one plain sentence without their name. Leave out their contact details. Never keep passwords, card or bank details, or health details.
Report a missing name in "missing", and a missing email and phone together as one entry for field "email" (the business needs at least one way to reach them).`

const digits = (value: string) => value.replace(/\D/g, '')

// Drafts one contact from the owner's text. Saves nothing; an email or phone the text doesn't contain is
// dropped, whatever the model says.
export async function draftContactFromText(
  organizationId: string,
  text: string,
): Promise<iContactDrafts> {
  const { records, missing } = await draftFromText({
    task: 'contactDrafts',
    instructions: contactDraftInstructions,
    schema: draftSchema,
    context: {},
    text,
    required: ['name'],
    maxRecords: 1,
    usage: { organizationId },
  })
  const record = records[0] ?? {
    name: null,
    email: null,
    phone: null,
    facts: [],
  }
  const hints: iDraftMissing[] = missing.filter(
    (item) => item.index === 0 && item.field !== 'email',
  )
  if (!records.length)
    hints.push({ index: 0, field: 'name', message: 'Add their name.' })
  const lower = text.toLowerCase()
  const email =
    record.email && lower.includes(record.email.toLowerCase())
      ? record.email.slice(0, 320)
      : null
  const phone =
    record.phone &&
    digits(record.phone).length >= 6 &&
    digits(text).includes(digits(record.phone))
      ? record.phone.slice(0, 40)
      : null
  if (email)
    try {
      normalizeEmail(email)
    } catch {
      hints.push({
        index: 0,
        field: 'email',
        message: 'This email doesn’t look complete. Check it.',
      })
    }
  if (phone)
    try {
      normalizePhone(phone)
    } catch {
      hints.push({
        index: 0,
        field: 'phone',
        message: 'Add the country code, for example +44.',
      })
    }
  if (!email && !phone)
    hints.push({
      index: 0,
      field: 'email',
      message: 'Add an email or phone so you can reach them.',
    })
  return {
    draft: {
      name: record.name?.slice(0, 200) ?? null,
      email,
      phone,
      facts: cleanFacts(record.facts, [], contactMemory.factsPerConversation),
    },
    missing: hints,
  }
}

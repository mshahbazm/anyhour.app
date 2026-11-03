export function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}
export function normalizePhone(value: string) {
  return value.replace(/[\s().-]/g, '')
}

export function extractContactDetails(messages: string[]) {
  const emails = new Set<string>()
  const phones = new Set<string>()
  for (const content of messages) {
    for (const match of content.matchAll(
      /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}/g,
    ))
      emails.add(normalizeEmail(match[0]))
    // Each candidate is bounded inside one message: never concatenate turns or digit fragments.
    for (const match of content.matchAll(
      /(?<![\w+])\+[1-9](?:[ \t().-]*\d){7,14}(?![ \t().-]*\d)/g,
    ))
      phones.add(normalizePhone(match[0]))
  }
  return { emails: [...emails], phones: [...phones] }
}

export function suppliedContactDetails(
  messages: string[],
  input: { name?: string; email?: string; phone?: string },
) {
  const candidates = extractContactDetails(messages)
  const email =
    input.email &&
    candidates.emails.find((value) => value === normalizeEmail(input.email!))
  const phone =
    input.phone &&
    candidates.phones.find((value) => value === normalizePhone(input.phone!))
  const name = input.name?.trim()
  const normalizedName = name?.toLowerCase().replace(/\s+/g, ' ')
  const namePresent =
    normalizedName &&
    messages.some((text) =>
      text.toLowerCase().replace(/\s+/g, ' ').includes(normalizedName),
    )
  return {
    email: email || undefined,
    phone: phone || undefined,
    name: namePresent ? name : undefined,
  }
}

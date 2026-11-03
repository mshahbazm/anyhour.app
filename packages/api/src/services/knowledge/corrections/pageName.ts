// "Pricing | Xvelopers" reads as "Pricing" next to the owner's own words.
export function pageName(title: string | null) {
  return title ? title.replace(/\s*\|.*$/, '') || title : null
}

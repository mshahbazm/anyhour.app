import {
  whatsappButton,
  whatsappQuestionLimits,
} from '../../config/whatsappQuestion.config'

// WhatsApp numbers as the owner types them, as websites link them, and as
// the WhatsApp button opens them. Stored as digits with the country code.

const { minDigits, maxDigits } = whatsappQuestionLimits
const digitsPattern = new RegExp(`^\\d{${minDigits},${maxDigits}}$`)

// wa.me/447700900123, api.whatsapp.com/send?phone=447700900123 (also web.
// and whatsapp://send?phone=), with an optional + before the digits.
const linkPatterns = [
  /(?:^|[^\w.])wa\.me\/\+?(\d{6,20})/gi,
  /(?:(?:api|web)\.whatsapp\.com\/send\/?|whatsapp:\/\/send\/?)\?(?:[^\s"'<>]*?&(?:amp;)?)?phone=(?:%2B|\+)?(\d{6,20})/gi,
]

/** Digits with the country code, or null when it isn't a WhatsApp number. */
export function parseWhatsappNumber(value: string) {
  const text = value.trim()
  for (const pattern of linkPatterns) {
    pattern.lastIndex = 0
    const match = pattern.exec(text)
    if (match) return digitsPattern.test(match[1]) ? match[1] : null
  }
  let compact = text.replace(/[\s().\- ]/g, '')
  if (compact.startsWith('+')) compact = compact.slice(1)
  else if (compact.startsWith('00')) compact = compact.slice(2)
  return digitsPattern.test(compact) ? compact : null
}

/** Every WhatsApp link's number in a text, in order, without repeats. */
export function whatsappLinkNumbers(text: string) {
  const found = new Set<string>()
  for (const pattern of linkPatterns)
    for (const match of text.matchAll(pattern))
      if (digitsPattern.test(match[1])) found.add(match[1])
  return [...found]
}

/** Where the WhatsApp button goes. */
export function whatsappUrl(number: string) {
  return `https://wa.me/${number}?text=${encodeURIComponent(whatsappButton.prefill)}`
}

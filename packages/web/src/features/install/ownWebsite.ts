// Mirrors packages/api/src/services/widget/ownWebsite.ts: hosts where an
// owner can't add the chat, so they're never suggested as their website.
const platforms = [
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'facebook.com',
  'fb.com',
  'instagram.com',
  'linkedin.com',
  'x.com',
  'twitter.com',
  'tiktok.com',
  'pinterest.com',
  'reddit.com',
  'medium.com',
  'substack.com',
  'wikipedia.org',
  'github.com',
  'google.com',
  'goo.gl',
  'apple.com',
  'amazon.com',
  'amazon.co.uk',
  'ebay.com',
  'etsy.com',
  'yelp.com',
  'tripadvisor.com',
  'trustpilot.com',
  'booking.com',
  'airbnb.com',
  'fiverr.com',
  'upwork.com',
  'linktr.ee',
  'wa.me',
  'whatsapp.com',
  'dropbox.com',
  'notion.so',
  'notion.site',
]

/** The origin of a typed or learned address, like "yourbusiness.com". */
export function originOf(value: string) {
  try {
    const url = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`,
    )
    return ['http:', 'https:'].includes(url.protocol) &&
      url.hostname.includes('.')
      ? url.origin
      : null
  } catch {
    return null
  }
}

/** Like originOf, but null for platforms the chat can't be installed on. */
export function ownWebsiteOrigin(value: string) {
  const origin = originOf(value)
  if (!origin) return null
  const host = new URL(origin).hostname.toLowerCase().replace(/^www\./, '')
  return platforms.some((item) => host === item || host.endsWith(`.${item}`))
    ? null
    : origin
}

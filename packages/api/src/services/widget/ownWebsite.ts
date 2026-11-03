// Hosts where an owner can't add our script: video, social, marketplaces,
// review sites and hosted documents. A link there is something the bot
// learns from, not the owner's own website.
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
] as const

/** The origin the chat could be installed on, or null for a platform. */
export function ownWebsiteOrigin(value: string) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const platform = platforms.some(
      (item) => host === item || host.endsWith(`.${item}`),
    )
    return platform ? null : url.origin
  } catch {
    return null
  }
}

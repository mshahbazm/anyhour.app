/** A typed website address as a full URL, or null when it isn't one. */
export function normalizeWebsite(value: string) {
  const text = value.trim()
  if (!text || /\s/.test(text)) return null
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    return ['http:', 'https:'].includes(url.protocol) &&
      url.hostname.includes('.')
      ? url.origin + (url.pathname === '/' ? '' : url.pathname)
      : null
  } catch {
    return null
  }
}

/** yourbusiness.com, for showing a URL back to the owner. */
export function websiteHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

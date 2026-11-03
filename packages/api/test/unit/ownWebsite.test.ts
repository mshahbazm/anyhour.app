import { describe, expect, test } from 'bun:test'
import { ownWebsiteOrigin } from '../../src/services/widget/ownWebsite'

describe('ownWebsiteOrigin', () => {
  test('a page on the owner’s site allows its whole origin', () => {
    expect(ownWebsiteOrigin('https://xvelopers.com/pricing')).toBe(
      'https://xvelopers.com',
    )
    expect(ownWebsiteOrigin('https://shop.example.co.uk/a/b')).toBe(
      'https://shop.example.co.uk',
    )
  })

  test('platforms and their subdomains are never allowed', () => {
    expect(ownWebsiteOrigin('https://www.youtube.com/watch?v=1')).toBeNull()
    expect(ownWebsiteOrigin('https://m.facebook.com/page')).toBeNull()
    expect(ownWebsiteOrigin('https://docs.google.com/document/d/1')).toBeNull()
  })

  test('look-alike hosts are not mistaken for platforms', () => {
    expect(ownWebsiteOrigin('https://notyoutube.com')).toBe(
      'https://notyoutube.com',
    )
  })
})

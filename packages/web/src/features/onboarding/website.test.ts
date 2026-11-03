/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { normalizeWebsite, websiteHost } from './website'

describe('normalizeWebsite', () => {
  test('adds https and drops a bare trailing slash', () => {
    expect(normalizeWebsite('yourbusiness.com')).toBe(
      'https://yourbusiness.com',
    )
    expect(normalizeWebsite(' http://shop.example.co.uk/ ')).toBe(
      'http://shop.example.co.uk',
    )
  })
  test('keeps a path', () => {
    expect(normalizeWebsite('example.com/clinic')).toBe(
      'https://example.com/clinic',
    )
  })
  test('rejects things that are not websites', () => {
    expect(normalizeWebsite('')).toBeNull()
    expect(normalizeWebsite('my business')).toBeNull()
    expect(normalizeWebsite('localhost')).toBeNull()
    expect(normalizeWebsite('ftp://example.com')).toBeNull()
  })
})

test('websiteHost', () => {
  expect(websiteHost('https://www.example.com/a')).toBe('example.com')
})

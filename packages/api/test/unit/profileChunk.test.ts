import { describe, expect, test } from 'bun:test'
import { encodingForModel } from 'js-tiktoken'
import {
  buildProfileChunk,
  profileChunkActionLimit,
  profileChunkActions,
} from '../../src/services/knowledge/profileChunk'
import type { iPageProfile } from '../../src/services/knowledge/cleanup/types'

const encoder = encodingForModel('text-embedding-3-small')
const profile: iPageProfile = {
  purposes: ['Contact sales'],
  visitorGoals: ['Book a consultation'],
  actions: [
    { label: 'Book a meeting', url: 'https://booking.example/?branch=1#slots' },
  ],
  topics: ['Sales', 'Support'],
  summary: 'Contact our team for help.',
}

describe('page profile chunks', () => {
  test('prioritizes fields and keeps exact destinations outside the embedded text', () => {
    const text = buildProfileChunk('Contact', profile)!
    expect(text.split('\n').map((line) => line.split(':')[0])).toEqual([
      'Title',
      'Purposes',
      'Visitor goals',
      'Actions',
      'Topics',
      'Summary',
    ])
    expect(text).not.toContain('https://')
    expect(
      profileChunkActions(text, [...profile.actions, ...profile.actions]),
    ).toEqual(profile.actions)
  })
  test('trims the summary after higher priority fields at 300 real tokens', () => {
    const text = buildProfileChunk('Contact', {
      ...profile,
      summary: 'Additional background detail. '.repeat(1000),
    })!
    expect(encoder.encode(text).length).toBeLessThanOrEqual(300)
    expect(text).toStartWith(
      'Title: Contact\nPurposes: Contact sales\nVisitor goals: Book a consultation\nActions: Book a meeting\nTopics: Sales; Support\nSummary: ',
    )
    expect(text).not.toEndWith('Additional background detail. '.repeat(1000))
  })
  test('multilingual trimming preserves valid Unicode and the token cap', () => {
    for (const summary of [
      'こんにちは世界🌍',
      'معلومات عن الخدمات',
      '😀🚀🧑🏽‍💻',
    ]) {
      const text = buildProfileChunk('Contact', {
        ...profile,
        summary: summary.repeat(1000),
      })!
      expect(encoder.encode(text).length).toBeLessThanOrEqual(300)
      expect(text).not.toContain('\uFFFD')
      expect(text).toContain('Actions: Book a meeting')
    }
  })
  test('does not invent profiles, repeats or links for omitted action labels', () => {
    expect(buildProfileChunk('Contact', null)).toBeNull()
    const text = buildProfileChunk('Contact', {
      ...profile,
      purposes: ['Contact sales', ' Contact   sales '],
    })!
    expect(text.match(/Contact sales/g)?.length).toBe(1)
    expect(
      profileChunkActions(
        'Title: Contact\nActions: Book a mee',
        profile.actions,
      ),
    ).toEqual([])
    expect(
      profileChunkActions('Title: Book a meeting', profile.actions),
    ).toEqual([])
  })
  test('handles literal special-token text and punctuation inside observed labels', () => {
    const action = {
      label: 'Sales; support',
      url: 'https://example.com/contact',
    }
    const text = buildProfileChunk('<|endoftext|>', {
      ...profile,
      actions: [action],
    })!
    expect(text).toContain('<|endoftext|>')
    expect(profileChunkActions(text, [action])).toEqual([action])
  })
  test('does not match a shorter action when the preceding label is truncated', () => {
    const actions = [
      { label: 'Book a meeting', url: 'https://example.com/meeting' },
      { label: 'Book', url: 'https://example.com/book' },
    ]
    expect(profileChunkActions('Actions: Book', actions)).toEqual([])
  })
  test('does not treat punctuation within a label as a separate action', () => {
    const actions = [
      { label: 'Sales; support', url: 'https://example.com/contact' },
      { label: 'support', url: 'https://example.com/support' },
    ]
    expect(profileChunkActions('Actions: Sales; support', actions)).toEqual([
      actions[0],
    ])
  })
  test('returns a repeated destination once even with different labels or spacing', () => {
    const actions = [
      { label: 'Book a meeting', url: 'https://example.com/book' },
      { label: ' Book  a meeting ', url: 'https://example.com/book' },
      { label: 'Schedule a call', url: 'https://example.com/book' },
    ]
    const text = buildProfileChunk('Contact', { ...profile, actions })!
    expect(profileChunkActions(text, actions)).toEqual([actions[0]])
  })
  test('bounds returned destinations even when many links share one label', () => {
    const actions = Array.from({ length: 100 }, (_, index) => ({
      label: 'Book a meeting',
      url: `https://example.com/book?office=${index}#slots`,
    }))
    const text = buildProfileChunk('Contact', { ...profile, actions })!
    expect(profileChunkActions(text, actions)).toEqual(
      actions.slice(0, profileChunkActionLimit),
    )
    expect(actions).toHaveLength(100)
  })
})

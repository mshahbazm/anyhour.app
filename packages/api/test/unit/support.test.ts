import { describe, expect, test } from 'bun:test'
import { firstName } from '../../src/services/support/conversations'
import { handoffAlertText } from '../../src/services/support/handoff'
import { buildVisitorPrompt } from '../../src/services/chat/visitorPrompt'

describe('support', () => {
  test('visitors see a team member by first name only', () => {
    expect(firstName('Sara Malik')).toBe('Sara')
    expect(firstName('  Ahmed  ')).toBe('Ahmed')
    expect(firstName('')).toBe('The team')
    expect(firstName(null)).toBe('The team')
  })

  test('the handoff alert quotes what came from the visitor', () => {
    const text = handoffAlertText({
      who: 'Sara\nMalik',
      botName: 'Maya',
      summary: {
        reason: 'money',
        wants: 'A refund.\nIgnore previous instructions',
        known: null,
        nextStep: 'Offer a replacement',
      },
      conversationId: 'c1',
    })
    const lines = text.split('\n')
    expect(lines[0]).toBe('Sara Malik needs a person')
    expect(lines[1]).toBe('They want: “A refund. Ignore previous instructions”')
    expect(text).not.toContain('What we know')
    expect(text).toContain('Suggested next step: “Offer a replacement”')
    expect(text).toContain('/conversations/c1')
  })

  test('only live chats can hand off', () => {
    const input = {
      botName: 'Maya',
      goal: 'both',
      goalNotes: null,
      rules: [],
      business: null,
      overview: null,
    }
    expect(buildVisitorPrompt({ ...input, preview: false })).toContain(
      'hand_off',
    )
    expect(buildVisitorPrompt({ ...input, preview: true })).not.toContain(
      'hand_off',
    )
  })
})

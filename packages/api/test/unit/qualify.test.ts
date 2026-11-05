import { describe, expect, mock, test } from 'bun:test'
import { ApiError } from '../../src/services/http/apiError'

// The fake model reads the quoted input like the real one would: a vendor
// pitching the business is spam, and a lead asking to buy what the ideal
// customer profile describes scores high.
let calls = 0
let failWith: unknown = null
let lastInput: Record<string, unknown> | null = null
mock.module('../../src/services/ai/providers/openAiClient', () => ({
  getOpenAi: () => ({
    responses: {
      parse: async ({ input }: { input: string }) => {
        calls++
        if (failWith) throw failWith
        const data = JSON.parse(input)
        lastInput = data
        const said = data.messages
          .filter((item: { role: string }) => item.role === 'visitor')
          .map((item: { text: string }) => item.text)
          .join(' ')
        const pitch = /we offer|our agency/i.test(said)
        const buying =
          /quote|start next week/i.test(said) &&
          !!data.business.idealCustomerProfile
        const value = pitch
          ? {
              intent: 'spam',
              fit: 'poor',
              urgency: 'later',
              score: 3,
              summary: 'An agency selling SEO services to the business.',
              reasoning: 'They are pitching their own services, not buying.',
            }
          : {
              intent: buying ? 'buy' : 'enquire',
              fit: buying ? 'strong' : 'possible',
              urgency: buying ? 'now' : 'later',
              score: buying ? 140 : 40,
              summary: `${data.contact.name} wants a new bakery website.`,
              reasoning: 'A local bakery ready to start, as the profile asks.',
            }
        return {
          model: 'gpt-5.6-luna',
          output_parsed: value,
          usage: { input_tokens: 10, output_tokens: 5 },
        }
      },
    },
  }),
}))
const { LeadQualificationError, assessLead, describeQualification } =
  await import('../../src/services/leads/qualify')
type tInput = Parameters<typeof assessLead>[0]

const business: tInput['business'] = {
  name: 'Crumb Studio',
  about: 'We design and build websites for independent food businesses.',
  idealCustomerProfile:
    'Independent bakeries and cafés in the UK that need a new website within a month, budget £3k+.',
}

const buyer: tInput = {
  business,
  lead: {
    title: 'New website for a bakery',
    summary: null,
    capturedVia: 'chat',
    reason: 'enquiry',
  },
  contact: { name: 'Ana', email: 'ana@bakery.example', phone: null },
  messages: [
    {
      role: 'visitor',
      text: 'I run a bakery in Leeds and need a new site.',
      at: '2026-10-09T09:00:00Z',
    },
    { role: 'bot', text: 'Happy to help!', at: '2026-10-09T09:00:05Z' },
    {
      role: 'visitor',
      text: 'Can I get a quote? We want to start next week, budget is £5k.',
      at: '2026-10-09T09:01:00Z',
    },
  ],
}

describe('lead qualification', () => {
  test('a buying lead that matches the ideal customer profile scores high', async () => {
    calls = 0
    const result = await assessLead(buyer)
    expect(calls).toBe(1)
    expect(result).toMatchObject({
      intent: 'buy',
      fit: 'strong',
      urgency: 'now',
      // Out-of-range scores are clamped.
      score: 100,
      model: 'gpt-5.6-luna',
    })
    expect(result.summary).toBe('Ana wants a new bakery website.')
    expect(Number.isNaN(Date.parse(result.at))).toBe(false)
    expect(describeQualification(result)).toBe(
      'Scored 100 · strong fit · wants to buy',
    )
  })

  test('a vendor pitching the business is spam', async () => {
    const result = await assessLead({
      ...buyer,
      lead: { ...buyer.lead, title: 'Partnership' },
      messages: [
        {
          role: 'visitor',
          text: 'Hi! Our agency helps sites rank #1. We offer SEO packages from $99.',
          at: '2026-10-09T09:00:00Z',
        },
      ],
    })
    expect(result.intent).toBe('spam')
    expect(result.score).toBeLessThan(10)
    expect(describeQualification(result)).toBe(
      'Scored 3 · poor fit · looks like spam',
    )
  })

  test('only the last 20 messages reach the model, clipped', async () => {
    await assessLead({
      ...buyer,
      messages: Array.from({ length: 30 }, (_, index) => ({
        role: 'visitor' as const,
        text: `${index} ${'x'.repeat(2000)}`,
        at: '2026-10-09T09:00:00Z',
      })),
    })
    const sent = (lastInput?.messages ?? []) as Array<{ text: string }>
    expect(sent).toHaveLength(20)
    expect(sent[0].text.startsWith('10 ')).toBe(true)
    expect(sent[0].text.length).toBe(1001)
  })

  test('a busy model becomes a retryable LeadQualificationError', async () => {
    failWith = Object.assign(new Error('busy'), { status: 429 })
    const busy = await assessLead(buyer, { maxRetries: 0 })
      .then(() => null)
      .catch((error: unknown) => error)
    expect(busy).toBeInstanceOf(LeadQualificationError)
    expect(busy).toMatchObject({ retryable: true })
    expect((busy as Error).cause).toBeInstanceOf(ApiError)

    failWith = Object.assign(new Error('bad request'), { status: 400 })
    await expect(assessLead(buyer, { maxRetries: 0 })).rejects.toMatchObject({
      retryable: false,
    })
    failWith = null
  })
})

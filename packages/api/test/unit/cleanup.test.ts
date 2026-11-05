import { describe, expect, test } from 'bun:test'
import { chunkText } from '../../src/services/knowledge/chunk'
import { getEncoding } from 'js-tiktoken'
import {
  classifyPageBlocks,
  shouldDiscard,
} from '../../src/services/knowledge/cleanup/classifyBlocks'
import {
  checkAnswer,
  DecisionDeferred,
  DecisionError,
  type iDecisionUsage,
} from '../../src/services/ai/decisions'
import { httpFailure } from '../../src/services/ai/providers/decisions/types'
import { extractPageBlocks } from '../../src/services/knowledge/cleanup/extractBlocks'
import { pageExcerpt } from '../../src/services/knowledge/cleanup/pageProfile'
import {
  cleanupLimits,
  makeCleanupRequest,
  planCleanupRequests,
  requestFits,
  shrinkCleanupJob,
  splitBlockText,
  type tCleanupRequest,
} from '../../src/services/knowledge/cleanup/cleanupRequests'
import {
  groupRepeatedBlocks,
  sharedBlockKey,
} from '../../src/services/knowledge/cleanup/repeatedBlocks'
import type {
  iCleanupCheckpoint,
  iPageBlock,
  tBlockKind,
} from '../../src/services/knowledge/cleanup/types'

const page = { url: 'https://example.com/services', title: 'Example services' }
const block = (
  id: string,
  text: string,
  extra: Partial<iPageBlock> = {},
): iPageBlock => ({
  id,
  text,
  heading: '',
  region: 'main',
  links: [],
  ...extra,
})
const parse = (html: string) => extractPageBlocks({ ...page, html }).blocks
const answer = (choice: tBlockKind, confidence = 0.99) => ({
  kind: 'choice' as const,
  choice,
  confidence,
  probabilities: {
    knowledge: choice === 'knowledge' ? 0.97 : 0.01,
    action: choice === 'action' ? 0.97 : 0.01,
    noise: choice === 'noise' ? 0.97 : 0.01,
    uncertain: choice === 'uncertain' ? 0.97 : 0.01,
  },
})
type tRequest = tCleanupRequest
type tFakeAnswer =
  | ReturnType<typeof answer>
  | { kind: 'refusal'; reason: 'declined' | 'invalid' }
const usage = (inputTokens: number, outputTokens: number): iDecisionUsage => ({
  provider: 'openai',
  model: 'gpt-6-luna',
  inputTokens,
  cachedInputTokens: 0,
  outputTokens,
  costUsd: '0',
})
// Answers as decide() returns them: in question order, checked like the
// base layer checks every provider's answers.
const responseFor = async (
  request: tRequest,
  choose: (id: string) => tFakeAnswer = () => answer('knowledge'),
) => ({
  answers: request.questions.map((question) =>
    checkAnswer({ ...choose(question.name), name: question.name }),
  ) as never,
  usage: usage(120, 12),
})
const checkpoint = (
  extra: Partial<iCleanupCheckpoint> = {},
): iCleanupCheckpoint => ({
  decisions: {},
  attempts: 0,
  activeMs: 0,
  complete: false,
  inputTokens: 0,
  outputTokens: 0,
  ...extra,
})
const ignoreSave = async () => {}
const noSleep = async () => {}

describe('HTML evidence extraction', () => {
  test('block-layout product cards retain their enclosing anchor destination', () => {
    const blocks = parse(
      '<main><a href="/book-suite"><div>Suite booking</div><p>Book this room from £150.</p></a></main>',
    )
    expect(blocks.map((item) => item.text)).toEqual([
      'Suite booking',
      'Book this room from £150.',
    ])
    expect(
      blocks.some((item) =>
        item.links.some(
          (link) => link.url === 'https://example.com/book-suite',
        ),
      ),
    ).toBe(true)
  })

  test('walks text once without duplicating nested parent and child content', () => {
    const blocks = parse(
      '<main><section>Before <p>Unique <strong>customer benefit</strong>.</p> After <div><p>Second paragraph.</p></div></section></main>',
    )
    expect(blocks.map((item) => item.text).join(' ')).toBe(
      'Before Unique customer benefit. After Second paragraph.',
    )
    expect(
      blocks.filter((item) => item.text.includes('customer benefit')),
    ).toHaveLength(1)
  })

  test('preserves header/navigation/footer facts and routable actions', () => {
    const blocks = parse(
      '<header><nav><a href="/book">Book now</a></nav></header><main><h1>Our hotel</h1><p>Comfortable rooms.</p></main><footer><p>Monday–Friday 9am–6pm</p><a href="tel:+4412345678">Call +44 1234 5678</a><p>© 2026 Example, 12 High Street</p></footer>',
    )
    expect(blocks.find((item) => item.text === 'Book now')).toMatchObject({
      region: 'navigation',
      links: [{ label: 'Book now', url: 'https://example.com/book' }],
    })
    expect(
      blocks.find((item) => item.text === 'Monday–Friday 9am–6pm')?.region,
    ).toBe('footer')
    expect(
      blocks.find((item) => item.text === 'Call +44 1234 5678')?.links[0]?.url,
    ).toBe('tel:+4412345678')
    expect(
      blocks.some((item) => item.text === '© 2026 Example, 12 High Street'),
    ).toBe(true)
  })

  test('keeps table cells together by row and closed accordion answers', () => {
    const blocks = parse(
      '<main><h2>Prices</h2><table><tr><th>Service</th><th>Price</th></tr><tr><td>Airport pickup</td><td>£45</td></tr></table><details><summary>Can children join?</summary><p>Children aged 8 and above can join with an adult.</p></details></main>',
    )
    expect(
      blocks.some(
        (item) =>
          item.text.includes('Airport pickup') && item.text.includes('£45'),
      ),
    ).toBe(true)
    expect(
      blocks.some((item) => item.text.includes('Children aged 8 and above')),
    ).toBe(true)
  })

  test('drops executable/style data but keeps alternate image text and list evidence', () => {
    const blocks = parse(
      '<script>secretScript()</script><style>.secretStyle{}</style><main><img alt="Wheelchair accessible entrance"><ul><li>Free parking</li><li>Breakfast included</li></ul></main>',
    )
    const text = blocks.map((item) => item.text).join(' ')
    expect(text).toContain('Wheelchair accessible entrance')
    expect(text).toContain('Free parking')
    expect(text).toContain('Breakfast included')
    expect(text).not.toContain('secret')
  })

  test('HTML remains authoritative when crawler markdown disagrees', () => {
    const result = extractPageBlocks({
      ...page,
      html: '<main><p>Actual HTML fact.</p></main>',
      markdown: 'Wrong alternate content.',
    })
    expect(result.blocks.map((item) => item.text)).toEqual([
      'Actual HTML fact.',
    ])
  })
})

describe('repeated site content', () => {
  test('shared prices retain their heading meaning without duplicating heading blocks', () => {
    const first = parse(
      '<footer><h3>Breakfast</h3><p>£15</p><h3>Dinner</h3><p>£35</p></footer>',
    )
    const second = parse(
      '<footer class="alternate"><h3>Breakfast</h3><p>£15</p><h3>Dinner</h3><p>£35</p></footer>',
    )
    const grouped = groupRepeatedBlocks([
      { sourceId: 'a', blocks: first },
      { sourceId: 'b', blocks: second },
    ])
    for (const sourceId of ['a', 'b']) {
      const sharedText = grouped.get(sourceId)?.shared.map((item) => item.text)
      expect(sharedText).toContain('Breakfast\n£15')
      expect(sharedText).toContain('Dinner\n£35')
      expect(sharedText).toContain('Breakfast')
      expect(sharedText).toContain('Dinner')
      expect(sharedText).not.toContain('Breakfast\nBreakfast')
      expect(sharedText).not.toContain('Dinner\nDinner')
      expect(grouped.get(sourceId)?.specific).toHaveLength(0)
    }
  })

  test('different classes, IDs and active-state attributes do not prevent matching', () => {
    const first = parse(
      '<footer id="footer-a" class="dark"><p>Open daily 9–5</p><a class="active" href="/book">Book a table</a></footer>',
    )
    const second = parse(
      '<footer id="footer-b" class="light"><p>Open daily 9–5</p><a aria-current="page" href="/book">Book a table</a></footer>',
    )
    const grouped = groupRepeatedBlocks([
      { sourceId: 'a', blocks: first },
      { sourceId: 'b', blocks: second },
    ])
    expect(grouped.get('a')?.shared.map((item) => item.text)).toEqual([
      'Open daily 9–5',
      '[Book a table](<https://example.com/book>)',
    ])
    expect(grouped.get('b')?.specific).toHaveLength(0)
  })

  test('different prices, hours and link destinations remain distinct', () => {
    const first = [
      block('p', 'Rooms from £90', { region: 'footer' }),
      block('h', 'Open 9–5', { region: 'footer' }),
      block('l', 'Book now', {
        region: 'navigation',
        links: [{ label: 'Book now', url: 'https://example.com/london' }],
      }),
    ]
    const second = [
      block('p', 'Rooms from £99', { region: 'footer' }),
      block('h', 'Open 9–6', { region: 'footer' }),
      block('l', 'Book now', {
        region: 'navigation',
        links: [{ label: 'Book now', url: 'https://example.com/paris' }],
      }),
    ]
    const grouped = groupRepeatedBlocks([
      { sourceId: 'a', blocks: first },
      { sourceId: 'b', blocks: second },
    ])
    expect(grouped.get('a')?.shared).toHaveLength(0)
    expect(grouped.get('b')?.specific).toHaveLength(3)
  })

  test('a repetition on one page alone and identical main-body facts are not site chrome', () => {
    const footer = block('f', 'Call us', { region: 'footer' })
    const main = block('m', 'Breakfast costs £15')
    const grouped = groupRepeatedBlocks([
      { sourceId: 'a', blocks: [footer, { ...footer, id: 'f2' }, main] },
      { sourceId: 'b', blocks: [main] },
    ])
    expect(grouped.get('a')?.shared).toHaveLength(0)
    expect(sharedBlockKey(main)).toBeNull()
  })
})

describe('Cleanup evidence and request budgets', () => {
  test('profile excerpts preserve decimal prices and abbreviated times', () => {
    const excerpt = pageExcerpt('Rooms', [
      block(
        'price',
        'A room costs £129.50 per night. Check-in starts at 3 p.m. daily.',
      ),
    ])
    expect(excerpt).toContain('£129.50 per night.')
    expect(excerpt).toContain('3 p.m. daily.')
  })

  test('multilingual embedding chunks keep every character within a byte budget', () => {
    const value = '漢字𠮷'.repeat(2400)
    const chunks = chunkText(value, '客室')
    expect(chunks.length).toBeGreaterThan(1)
    expect(
      chunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= 6000),
    ).toBe(true)
    expect(chunks.every((chunk) => !chunk.includes('�'))).toBe(true)
    // This unbroken input has no word overlap; whitespace is only added at chunk boundaries.
    expect(
      chunks
        .map((chunk) => chunk.slice('客室\n'.length).replace(/\s/gu, ''))
        .join(''),
    ).toBe(value)
  })

  test('page profiles reserve space for body facts despite 100 headings', () => {
    const blocks = Array.from({ length: 100 }, (_, i) =>
      block(
        `section${i}`,
        `The hotel provides airport pickup for party ${i}.`,
        {
          heading: `Visitor planning section ${i}: detailed accommodation and arrival information`,
        },
      ),
    )
    const excerpt = pageExcerpt('Hotel planning guide', blocks)
    expect(
      getEncoding('o200k_base').encode(excerpt).length,
    ).toBeLessThanOrEqual(1000)
    expect(excerpt).toContain('The hotel provides airport pickup for party 0.')
    expect(excerpt).toContain('The hotel provides airport pickup for party 10.')
  })

  test('classifies long and numerical blocks instead of using the old short-text shortcut', () => {
    const text =
      'Hotel rooms cost £120 including breakfast, and children aged 8 can join the tour. '.repeat(
        6,
      )
    const { jobs, fragments } = planCleanupRequests(page, [
      block('long', text),
      block('price', '£199'),
    ])
    expect(fragments.map((item) => item.parentId)).toEqual(['long', 'price'])
    expect(jobs.flatMap((job) => job.targets)).toEqual(
      fragments.map((item) => item.id),
    )
    expect(jobs[0]?.fullPage).toBe(true)
    expect(jobs[0]?.context.map((item) => item.text)).toEqual([text, '£199'])
  })

  test('question batching repeats full page context while covering each target once', () => {
    const blocks = Array.from({ length: 8 }, (_, i) =>
      block(`b${i}`, `Useful fact ${i}.`),
    )
    const budgets = { inputBytes: 24_000, requestBytes: 4_000 }
    const { jobs, fragments } = planCleanupRequests(page, blocks, budgets)
    expect(jobs.length).toBeGreaterThan(1)
    expect(
      jobs.every(
        (job) => job.fullPage && job.context.length === fragments.length,
      ),
    ).toBe(true)
    expect(jobs.flatMap((job) => job.targets)).toEqual(
      fragments.map((item) => item.id),
    )
    expect(jobs.every((job) => requestFits(page, job, budgets))).toBe(true)
    for (const job of jobs)
      for (const id of job.targets) {
        const request = makeCleanupRequest(page, job)
        expect(
          request.questions.find((question) => question.name === id)
            ?.instructions,
        ).toContain(
          `blocks[${job.context.findIndex((item) => item.id === id)}]`,
        )
      }
  })

  test('large pages use bounded section windows without omitting targets', () => {
    const blocks = Array.from({ length: 25 }, (_, i) =>
      block(
        `section${i}`,
        `Section ${i}. ${'Useful information. '.repeat(12)}`,
        { heading: `Heading ${i}` },
      ),
    )
    const budgets = { inputBytes: 4_000, requestBytes: 10_000 }
    const { jobs, fragments } = planCleanupRequests(page, blocks, budgets)
    expect(jobs.length).toBeGreaterThan(1)
    expect(
      jobs.every((job) => !job.fullPage && requestFits(page, job, budgets)),
    ).toBe(true)
    expect(jobs.flatMap((job) => job.targets)).toEqual(
      fragments.map((item) => item.id),
    )
    expect(
      jobs.every((job) =>
        job.targets.every((id) => job.context.some((item) => item.id === id)),
      ),
    ).toBe(true)
  })

  test('oversized multilingual text preserves all characters, whitespace and final tail', () => {
    const text = `  日本語😀 café!\n${'مرحبا 🌍 '.repeat(600)} END_OF_PAGE  `
    const parts = splitBlockText(text, 129)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join('')).toBe(text)
    expect(
      parts.every(
        (part) => Buffer.byteLength(part) <= 129 && !part.includes('\uFFFD'),
      ),
    ).toBe(true)
    const { fragments, jobs } = planCleanupRequests(
      page,
      [block('unicode', text)],
      { inputBytes: 4_000, requestBytes: 10_000 },
    )
    expect(fragments.map((item) => item.text).join('')).toBe(text)
    expect(jobs.flatMap((job) => job.targets)).toEqual(
      fragments.map((item) => item.id),
    )
    expect(fragments.at(-1)?.text).toEndWith('END_OF_PAGE  ')
  })

  test('criteria go once in the input or with every question, never both', () => {
    const { jobs } = planCleanupRequests(page, [
      block('a', 'Open 9–5'),
      block('b', 'Book now'),
    ])
    const shared = makeCleanupRequest(page, jobs[0], true)
    expect(shared.input).toHaveProperty('criteria')
    expect(shared.questions.map((q) => q.instructions)).toEqual([
      'Classify `blocks[0]` using the instructions and criteria above.',
      'Classify `blocks[1]` using the instructions and criteria above.',
    ])
    expect(
      shared.questions[0].choices.every((c) => c.description === c.value),
    ).toBe(true)
    const each = makeCleanupRequest(page, jobs[0], false)
    expect(each.input).not.toHaveProperty('criteria')
    expect(each.questions[0].instructions).toStartWith(
      'Classify only the actual content of `blocks[0]` for an assistant',
    )
    expect(each.questions[0].choices[2].description).toContain(
      'cookie consent controls',
    )
  })

  test('context splitting has a strict depth limit and preserves Unicode text', () => {
    const target = { ...block('b0', '🌍مرحبا '.repeat(40)), parentId: 'b0' }
    const job = {
      context: [target],
      targets: [target.id],
      fullPage: false,
      depth: 0,
    }
    const children = shrinkCleanupJob(job)
    expect(children.length).toBeGreaterThan(1)
    expect(
      children
        .flatMap((child) => child.context.map((item) => item.text))
        .join(''),
    ).toBe(target.text)
    expect(
      shrinkCleanupJob({ ...job, depth: cleanupLimits.splitDepth }),
    ).toEqual([])
  })
})

describe('conservative decisions and bounded recovery', () => {
  test.each([
    { knowledge: 0.2, action: 0.56, noise: 0.07, uncertain: 0.16 },
    { knowledge: 0.2, action: 0.57, noise: 0.08, uncertain: 0.16 },
  ])(
    'accepts provider-rounded probability totals near one: %j',
    async (probabilities) => {
      const blocks = [block('booking', 'Book a room')]
      const result = await classifyPageBlocks(page, blocks, {
        save: ignoreSave,
        send: async (request) =>
          responseFor(request, () => ({
            ...answer('action', 0.45),
            probabilities,
          })),
      })
      expect(result.blocks).toEqual(blocks)
      expect(result.checkpoint.decisions.booking_0?.kind).toBe('action')
      expect(result.checkpoint.complete).toBe(true)
      expect(result.checkpoint.reason).toBeUndefined()
    },
  )

  test('genuinely invalid probability total 1.3 cannot discard useful text', async () => {
    const blocks = [block('hours', 'Open 9am to 6pm')]
    const result = await classifyPageBlocks(page, blocks, {
      save: ignoreSave,
      send: async (request) =>
        responseFor(request, () => ({
          ...answer('noise'),
          probabilities: {
            knowledge: 0.1,
            action: 0.1,
            noise: 1,
            uncertain: 0.1,
          },
        })),
    })
    expect(result.blocks).toEqual(blocks)
    expect(result.checkpoint.decisions.hours_0?.kind).toBe('uncertain')
    expect(result.checkpoint.complete).toBe(false)
    expect(result.checkpoint.reason).toBe('invalidDecision')
  })

  test('only confident noise is removed; facts, actions and uncertainty stay', async () => {
    const blocks = [
      block('fact', 'Call 123456'),
      block('action', 'Book now'),
      block('weak', 'Maybe irrelevant'),
      block('noise', 'Reject cookies'),
    ]
    const result = await classifyPageBlocks(page, blocks, {
      save: ignoreSave,
      send: async (request) =>
        responseFor(request, (id) =>
          id.startsWith('noise')
            ? answer('noise')
            : id.startsWith('weak')
              ? answer('noise', 0.94)
              : id.startsWith('action')
                ? answer('action')
                : answer('knowledge'),
        ),
    })
    expect(result.blocks.map((item) => item.id)).toEqual([
      'fact',
      'action',
      'weak',
    ])
    expect(result.checkpoint.complete).toBe(true)
    expect(result.checkpoint.inputTokens).toBe(120)
    expect(shouldDiscard({ kind: 'uncertain', confidence: 1 })).toBe(false)
  })

  test('invalid probabilities, mismatched choices and missing answers retain affected content', async () => {
    const blocks = [
      block('bad', 'Opening hours'),
      block('mismatch', 'Prices'),
      block('missing', 'Address'),
      block('good', 'Book now'),
    ]
    const result = await classifyPageBlocks(page, blocks, {
      save: ignoreSave,
      // Bad totals and mismatched choices come back from the base layer as
      // invalid; the last answer is missing.
      send: async (request) => ({
        answers: [
          checkAnswer({
            ...answer('noise'),
            name: 'bad_0',
            probabilities: { knowledge: 0, action: 0, noise: 2, uncertain: 0 },
          }),
          checkAnswer({
            ...answer('knowledge'),
            name: 'mismatch_0',
            choice: 'noise',
          }),
          undefined,
          checkAnswer({ ...answer('action'), name: request.questions[3].name }),
        ] as never,
        usage: usage(12, 3),
      }),
    })
    expect(result.blocks).toEqual(blocks)
    expect(result.checkpoint.complete).toBe(false)
    expect(result.checkpoint.decisions.missing_0?.kind).toBe('uncertain')
    expect(result.checkpoint.decisions.good_0?.kind).toBe('action')
  })

  test.each(['invalidResponse', 'authentication', 'rejected'] as const)(
    'a provider %s failure retains source text without retrying',
    async (failure) => {
      const blocks = [block('fact', 'Hours: 9–5')]
      const result = await classifyPageBlocks(page, blocks, {
        save: ignoreSave,
        send: async () => {
          throw new DecisionError(failure)
        },
      })
      expect(result.blocks).toEqual(blocks)
      expect(result.checkpoint.complete).toBe(false)
      expect(result.checkpoint.attempts).toBe(1)
    },
  )

  test('all-noise output never replaces a source with empty text', async () => {
    const blocks = [block('only', 'Possibly useful information')]
    const result = await classifyPageBlocks(page, blocks, {
      save: ignoreSave,
      send: async (request) => responseFor(request, () => answer('noise')),
    })
    expect(result.blocks).toEqual(blocks)
    expect(result.checkpoint.reason).toBe('emptyCleanupResult')
  })

  test('network failures stop after finite retries and retain all source text', async () => {
    let calls = 0
    const sleeps: number[] = []
    const blocks = [block('fact', 'Important fact')]
    const result = await classifyPageBlocks(page, blocks, {
      save: ignoreSave,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      send: async () => {
        calls++
        throw new Error('Network down')
      },
    })
    expect(calls).toBe(3)
    expect(sleeps).toEqual([1000, 2000])
    expect(result.blocks).toEqual(blocks)
    expect(result.checkpoint.complete).toBe(false)
  })

  test('generic 422 is not treated as a context-size problem or retried', async () => {
    let calls = 0
    const blocks = [block('a', 'Important fact'), block('b', 'Book now')]
    const result = await classifyPageBlocks(page, blocks, {
      save: ignoreSave,
      sleep: noSleep,
      send: async () => {
        calls++
        throw await httpFailure(
          new Response('Invalid request schema', { status: 422 }),
        )
      },
    })
    expect(calls).toBe(1)
    expect(result.blocks).toEqual(blocks)
    expect(result.checkpoint.reason).toBe('requestRejected')
  })

  test('explicit context-size rejection splits work and preserves useful child decisions', async () => {
    const requests: tRequest[] = []
    const blocks = [block('fact', 'Hours: 9–5'), block('noise', 'Close popup')]
    const result = await classifyPageBlocks(page, blocks, {
      save: ignoreSave,
      sleep: noSleep,
      send: async (request) => {
        requests.push(request)
        if (requests.length === 1)
          throw await httpFailure(
            new Response('Input exceeds maximum context limit', {
              status: 422,
            }),
          )
        return responseFor(request, (id) =>
          answer(id.startsWith('noise') ? 'noise' : 'knowledge'),
        )
      },
    })
    expect(requests).toHaveLength(3)
    expect(
      requests.slice(1).every((request) => request.input.blocks.length === 1),
    ).toBe(true)
    expect(result.blocks.map((item) => item.id)).toEqual(['fact'])
  })

  test('one useful fragment prevents removal of a long parent block', async () => {
    const text =
      'Reject cookies. '.repeat(900) + 'The last shuttle leaves at 18:30.'
    const blocks = [
      block('mixed', text),
      block('fact', 'Address 12 High Street'),
    ]
    const seen: string[] = []
    const result = await classifyPageBlocks(page, blocks, {
      save: ignoreSave,
      send: async (request) =>
        responseFor(request, (id) => {
          const target = request.input.blocks.find((item) => item.id === id)!
          seen.push(target.text)
          return answer(
            target.text.includes('18:30') || target.parentId === 'fact'
              ? 'knowledge'
              : 'noise',
          )
        }),
    })
    expect(result.blocks).toEqual(blocks)
    expect(seen.join('')).toContain('The last shuttle leaves at 18:30.')
  })

  test('persisted attempt cap prevents further requests after restart', async () => {
    let calls = 0
    const blocks = [block('fact', 'Hours: 9–5')]
    const result = await classifyPageBlocks(page, blocks, {
      checkpoint: checkpoint({ attempts: cleanupLimits.attempts }),
      save: ignoreSave,
      send: async (request) => {
        calls++
        return responseFor(request)
      },
    })
    expect(calls).toBe(0)
    expect(result.blocks).toEqual(blocks)
    expect(result.checkpoint.complete).toBe(false)
  })

  test('long Retry-After is deferred durably, with no sleeping or second call', async () => {
    let calls = 0,
      sleeps = 0
    const saved: iCleanupCheckpoint[] = []
    await expect(
      classifyPageBlocks(page, [block('a', 'Important')], {
        now: () => 1000,
        save: async (state) => {
          saved.push(structuredClone(state))
        },
        sleep: async () => {
          sleeps++
        },
        send: async () => {
          calls++
          throw await httpFailure(
            new Response('Busy', {
              status: 429,
              headers: { 'retry-after': '60' },
            }),
          )
        },
      }),
    ).rejects.toBeInstanceOf(DecisionDeferred)
    expect(calls).toBe(1)
    expect(sleeps).toBe(0)
    expect(saved.at(-1)?.retryAt).toBe(61_000)
  })

  test('successful retry completes the page instead of retaining a stale transient error', async () => {
    let calls = 0
    const result = await classifyPageBlocks(
      page,
      [block('a', 'Important fact')],
      {
        save: ignoreSave,
        sleep: noSleep,
        send: async (request) => {
          calls++
          if (calls === 1)
            throw await httpFailure(
              new Response('Temporarily unavailable', { status: 503 }),
            )
          return responseFor(request)
        },
      },
    )
    expect(calls).toBe(2)
    expect(result.checkpoint.complete).toBe(true)
    expect(result.checkpoint.reason).toBeUndefined()
  })

  test('an interrupted HTTP error body is a bounded provider failure, not an uncaught page failure', async () => {
    let calls = 0
    const blocks = [block('a', 'Important fact')]
    const result = await classifyPageBlocks(page, blocks, {
      save: ignoreSave,
      sleep: noSleep,
      send: async () => {
        calls++
        throw await httpFailure(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error('Body connection reset'))
              },
            }),
            { status: 503 },
          ),
        )
      },
    })
    expect(calls).toBeLessThanOrEqual(cleanupLimits.retries)
    expect(result.blocks).toEqual(blocks)
    expect(result.checkpoint.complete).toBe(false)
  })

  test('a checkpoint deferred until the future does not make or sleep through a request', async () => {
    let calls = 0,
      sleeps = 0
    await expect(
      classifyPageBlocks(page, [block('a', 'Fact')], {
        checkpoint: checkpoint({ retryAt: 60_000 }),
        now: () => 1000,
        save: ignoreSave,
        sleep: async () => {
          sleeps++
        },
        send: async (request) => {
          calls++
          return responseFor(request)
        },
      }),
    ).rejects.toBeInstanceOf(DecisionDeferred)
    expect(calls).toBe(0)
    expect(sleeps).toBe(0)
  })

  test('persisted active-time budget stops work across restarts', async () => {
    let calls = 0
    const blocks = [block('a', 'Fact')]
    const result = await classifyPageBlocks(page, blocks, {
      checkpoint: checkpoint({ activeMs: cleanupLimits.activeMs }),
      now: () => 1000,
      save: ignoreSave,
      send: async (request) => {
        calls++
        return responseFor(request)
      },
    })
    expect(calls).toBe(0)
    expect(result.blocks).toEqual(blocks)
    expect(result.checkpoint.complete).toBe(false)
  })

  test('failed attempt-budget persistence prevents an external request', async () => {
    let calls = 0
    await expect(
      classifyPageBlocks(page, [block('a', 'Fact')], {
        save: async () => {
          throw new Error('Checkpoint unavailable')
        },
        send: async (request) => {
          calls++
          return responseFor(request)
        },
      }),
    ).rejects.toThrow('Checkpoint unavailable')
    expect(calls).toBe(0)
  })

  test('completed checkpoint decisions are resumed without duplicate paid requests', async () => {
    let calls = 0
    const blocks = [block('fact', 'Fact'), block('noise', 'Cookie controls')]
    const result = await classifyPageBlocks(page, blocks, {
      checkpoint: checkpoint({
        decisions: {
          fact_0: { kind: 'knowledge', confidence: 0.99 },
          noise_0: { kind: 'noise', confidence: 0.99 },
        },
        attempts: 1,
      }),
      save: ignoreSave,
      send: async (request) => {
        calls++
        return responseFor(request)
      },
    })
    expect(calls).toBe(0)
    expect(result.blocks.map((item) => item.id)).toEqual(['fact'])
    expect(result.checkpoint.complete).toBe(true)
  })
})

describe('profile excerpts of long documents', () => {
  test('a long document without headings is sampled from start to end', () => {
    const blocks = Array.from({ length: 400 }, (_, i) =>
      block(`p${i}`, `Chapter fact number ${i} about the hotel garden.`),
    )
    const excerpt = pageExcerpt('Guide', blocks)
    expect(excerpt).toContain('Chapter fact number 0 ')
    expect(excerpt).toContain('Chapter fact number 200 ')
    expect(excerpt).toMatch(/Chapter fact number 3\d\d /)
    const numbers = [...excerpt.matchAll(/number (\d+)/g)].map((m) =>
      Number(m[1]),
    )
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
  })
})

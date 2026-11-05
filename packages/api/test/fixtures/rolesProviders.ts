import { structuredResponse } from './openAiResponses'

// A small two-tone JPEG: the faked image model's picture.
export const fixtureJpeg =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLi' +
  'kxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZP' +
  'NS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0' +
  '//wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL' +
  '/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0f' +
  'AkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1' +
  'dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1N' +
  'XW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQF' +
  'BgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRob' +
  'HBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVm' +
  'Z2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExc' +
  'bHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDaooorxz2w' +
  'ooooAKKKKACiiigAooooAKKKKACiiigAooooA5uiiivqz5MKKKKACiiigAooooAKKKKACi' +
  'iigAooooAKKKKAP//Z'

// What one stand-in Spider read reports it cost, in USD.
export const spiderReadCostUsd = 0.00001

/**
 * A stand-in for Spider's `POST /scrape` (SPIDER_API_URL): real Spider can't
 * reach the fixture websites on 127.0.0.1, so this reads the requested
 * address itself and answers in Spider's response shape: one page, `content`
 * per `return_format` (raw text, or bytes as numbers), the website's
 * `status`, its headers with `return_headers`, and `costs`. Every `request`
 * mode (smart, browser, http) and stealth read the same way.
 */
export async function spiderScrape(request: Request) {
  if (!request.headers.get('authorization')?.startsWith('Bearer '))
    return new Response('Missing API key', { status: 401 })
  const body = (await request.json()) as {
    url: string
    return_format?: 'raw' | 'bytes'
    return_headers?: boolean
  }
  const costs = {
    total_cost: spiderReadCostUsd,
    compute_cost: 0,
    bytes_transfer_cost: spiderReadCostUsd,
    file_cost: 0,
    ai_cost: 0,
  }
  let response: Response
  try {
    response = await fetch(body.url, { signal: AbortSignal.timeout(20_000) })
  } catch {
    // Spider couldn't reach the website: no status, an error, nothing billed.
    return Response.json([
      {
        url: body.url,
        content: null,
        error: 'Website unreachable',
        costs: null,
      },
    ])
  }
  const content =
    body.return_format === 'bytes'
      ? Array.from(new Uint8Array(await response.arrayBuffer()))
      : await response.text()
  return Response.json([
    {
      url: response.url || body.url,
      content,
      status: response.status,
      error: null,
      ...(body.return_headers
        ? { headers: Object.fromEntries(response.headers) }
        : {}),
      costs,
    },
  ])
}

/** The env that points the page reader at a stand-in Spider at `origin`. */
export const spiderStandInEnv = (origin: string) => ({
  PAGE_READER_PROVIDER: 'spider',
  SPIDER_API_KEY: 'fixture-key',
  SPIDER_API_URL: `${origin}/scrape`,
})

/**
 * A stand-in Spider of its own, for tests with their own provider fixtures:
 * assign `env` to process.env before the app loads.
 */
export function startSpiderStandIn() {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === '/scrape' && request.method === 'POST'
        ? spiderScrape(request)
        : new Response('Unknown fixture request', { status: 404 }),
  })
  server.unref()
  return { server, env: spiderStandInEnv(`http://127.0.0.1:${server.port}`) }
}

// Local protocol fixtures keep the HTTP/worker integration independent of paid
// services. Websites are read through a stand-in Spider (spiderScrape).
export function startRolesProviders() {
  const objects = new Map<string, ArrayBuffer>()
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (
        ['/stage', '/stage/'].includes(url.pathname) &&
        url.searchParams.has('list-type')
      )
        return new Response(
          '<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>',
          { headers: { 'content-type': 'application/xml' } },
        )
      if (url.pathname.startsWith('/stage/')) {
        if (request.method === 'PUT') {
          objects.set(url.pathname, await request.arrayBuffer())
          return new Response(null)
        }
        if (request.method === 'DELETE') {
          objects.delete(url.pathname)
          return new Response(null, { status: 204 })
        }
        return objects.has(url.pathname)
          ? new Response(objects.get(url.pathname))
          : new Response('Missing fixture object', { status: 404 })
      }
      if (url.pathname === '/scrape' && request.method === 'POST')
        return spiderScrape(request)
      if (url.pathname === '/v1/embeddings') {
        const { input } = (await request.json()) as { input: string[] }
        return Response.json({
          data: input.map((_, index) => ({
            index,
            embedding: Array.from({ length: 384 }, (_, dimension) =>
              dimension === 0 ? 1 : 0,
            ),
          })),
          usage: { prompt_tokens: input.length, total_tokens: input.length },
        })
      }
      if (url.pathname === '/v1/responses') {
        const body = (await request.json()) as {
          input: unknown
          text?: { format?: { name?: string } }
        }
        // Saving a fact the website prices differently: one page disagrees.
        if (body.text?.format?.name === 'factConflict') {
          const differs = JSON.stringify(body.input).includes('$250')
          return structuredResponse({
            conflicts: differs
              ? [
                  {
                    passage: 0,
                    pageValue: '$200',
                    newValue: '$250',
                    bothCanBeTrue: false,
                    pageSays: 'Blog add-on: $200',
                  },
                ]
              : [],
            youWillSay: 'Blog add-on: $250',
          })
        }
        return structuredResponse(
          {
            summary: 'Plumbing business information.',
            purposes: ['Inform visitors'],
            topics: ['Plumbing'],
            visitorGoals: ['Request repairs'],
            actions: [],
          },
          { input: 10, output: 10 },
          'gpt-5.6-luna',
        )
      }
      // Generated images: a tiny JPEG, with image-model usage.
      if (
        url.pathname === '/v1/images/generations' ||
        url.pathname === '/v1/images/edits'
      )
        return Response.json({
          created: 1,
          data: [{ b64_json: fixtureJpeg }],
          usage: {
            input_tokens: 20,
            input_tokens_details: { text_tokens: 20, image_tokens: 0 },
            output_tokens: 272,
            total_tokens: 292,
          },
        })
      if (url.pathname === '/jev') {
        const { questions } = (await request.json()) as {
          questions: Record<string, unknown>
        }
        return Response.json({
          model: 'jev-1.13.0',
          answers: Object.fromEntries(
            Object.keys(questions).map((key) => [
              key,
              {
                type: 'choice',
                choice: 'knowledge',
                confidence: 1,
                probabilities: {
                  knowledge: 1,
                  action: 0,
                  noise: 0,
                  uncertain: 0,
                },
              },
            ]),
          ),
          usage: { input_tokens: 1, output_tokens: 1 },
        })
      }
      return new Response('Unknown fixture request', { status: 404 })
    },
  })
  const origin = `http://127.0.0.1:${server.port}`
  return {
    server,
    env: {
      OPENAI_API_KEY: 'fixture-key',
      OPENAI_BASE_URL: `${origin}/v1`,
      R2_ENDPOINT: origin,
      R2_BUCKET: 'stage',
      R2_ACCESS_KEY_ID: 'fixture-key',
      R2_SECRET_ACCESS_KEY: 'fixture-secret',
      TYPESAFE_API_KEY: 'fixture-key',
      DECISION_PROVIDER: 'typesafe',
      TYPESAFE_API_URL: `${origin}/jev`,
      ...spiderStandInEnv(origin),
    },
  }
}

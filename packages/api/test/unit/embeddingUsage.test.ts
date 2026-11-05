import { expect, mock, test } from 'bun:test'

let calls = 0
mock.module('../../src/services/ai/providers/openAiClient', () => ({
  getOpenAi: () => ({
    embeddings: {
      create: async ({ input }: { input: string[] }) => {
        calls++
        if (calls === 2) throw new Error('second batch unavailable')
        return {
          data: input.map((_, index) => ({
            index,
            embedding: Array.from({ length: 384 }, () => 1),
          })),
          usage: { total_tokens: 123 },
        }
      },
    },
  }),
}))
const { embedTexts } = await import('../../src/services/knowledge/embedding')

function memoryCheckpoint(
  onUsage: (tokens: number) => Promise<void> = async () => {},
) {
  const batches = new Map<string, number[][]>()
  return {
    read: async (hash: string) => batches.get(hash) ?? null,
    write: async (hash: string, vectors: number[][], tokens: number) => {
      await onUsage(tokens)
      batches.set(hash, vectors)
    },
  }
}

test('records each completed provider batch even if a later batch fails', async () => {
  calls = 0
  const recorded: number[] = []
  await expect(
    embedTexts(
      Array.from({ length: 129 }, () => 'text'),
      {
        onUsage: async (tokens) => {
          recorded.push(tokens)
        },
      },
    ),
  ).rejects.toThrow('The AI service is unavailable')
  expect(recorded).toEqual([123])
})

test('records a successful response once and does not record empty input', async () => {
  calls = 0
  const recorded: number[] = []
  const options = {
    onUsage: async (tokens: number) => {
      recorded.push(tokens)
    },
  }
  await embedTexts(['text'], options)
  await embedTexts([], options)
  expect(recorded).toEqual([123])
  expect(calls).toBe(1)
})

test('a retry reuses successful earlier batches without repeating usage', async () => {
  calls = 0
  const recorded: number[] = []
  const options = {
    checkpoint: memoryCheckpoint(async (tokens) => {
      recorded.push(tokens)
    }),
    onUsage: async (tokens: number) => {
      recorded.push(tokens)
    },
  }
  const input = Array.from({ length: 129 }, (_, index) => `paragraph ${index}`)
  await expect(embedTexts(input, options)).rejects.toThrow(
    'The AI service is unavailable',
  )
  const resumed = await embedTexts(input, options)
  expect(resumed.vectors).toHaveLength(129)
  expect(calls).toBe(3)
  expect(recorded).toEqual([123, 123])
})

test('shared failure and publication failure preserve earlier content/profile batches', async () => {
  calls = 0
  const recorded: number[] = []
  const options = {
    checkpoint: memoryCheckpoint(async (tokens) => {
      recorded.push(tokens)
    }),
    onUsage: async (tokens: number) => {
      recorded.push(tokens)
    },
  }
  await embedTexts(['content', 'profile'], options)
  await expect(embedTexts(['shared'], options)).rejects.toThrow(
    'The AI service is unavailable',
  )
  await embedTexts(['content', 'profile'], options)
  await embedTexts(['shared'], options)
  expect(calls).toBe(3)
  // Simulate retry after publication rejects the vectors: no new provider work.
  await embedTexts(['shared'], options)
  await embedTexts(['content', 'profile'], options)
  expect(calls).toBe(3)
  expect(recorded).toEqual([123, 123])
})

test('checkpoint keys distinguish exact input and order', async () => {
  calls = 2 // The fixture's sole failing call has already passed.
  const options = { checkpoint: memoryCheckpoint(), onUsage: async () => {} }
  await embedTexts(['a', 'b'], options)
  await embedTexts(['b', 'a'], options)
  await embedTexts(['a', 'b '], options)
  await embedTexts(['a', 'b'], options)
  expect(calls).toBe(5)
})

import { getOpenAi } from '../ai/openAi'
import { embeddingModel } from '../../config/models.config'
import { createHash } from 'node:crypto'

export interface iEmbeddingCheckpoint {
  read(inputHash: string): Promise<number[][] | null>
  write(inputHash: string, vectors: number[][], tokens: number): Promise<void>
}

export interface iEmbeddingOptions {
  signal?: AbortSignal
  onUsage: (tokens: number) => Promise<void>
  checkpoint?: iEmbeddingCheckpoint
}

function validVectors(vectors: number[][], length: number) {
  return (
    Array.isArray(vectors) &&
    vectors.length === length &&
    vectors.every(
      (vector) =>
        Array.isArray(vector) &&
        vector.length === embeddingModel.dimensions &&
        vector.every(Number.isFinite) &&
        vector.some((value) => value !== 0),
    )
  )
}

export async function embedTexts(texts: string[], options: iEmbeddingOptions) {
  if (!texts.length) return { vectors: [] as number[][], tokens: 0 }
  const vectors: number[][] = []
  let tokens = 0
  const deadline = AbortSignal.timeout(8 * 60_000)
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline
  for (let start = 0; start < texts.length;) {
    signal.throwIfAborted()
    // UTF-8 bytes conservatively bound BPE tokens, including multilingual text.
    // Keep aggregate requests below the provider's token cap as well as its item cap.
    const batch: string[] = []
    let bytes = 0
    while (start + batch.length < texts.length && batch.length < 128) {
      const text = texts[start + batch.length]
      const size = Buffer.byteLength(text, 'utf8')
      if (batch.length && bytes + size > 240_000) break
      batch.push(text)
      bytes += size
    }
    const inputHash = createHash('sha256')
      .update(
        JSON.stringify({
          model: embeddingModel.id,
          dimensions: embeddingModel.dimensions,
          input: batch,
        }),
      )
      .digest('hex')
    const cached = await options.checkpoint?.read(inputHash)
    if (cached && validVectors(cached, batch.length)) {
      vectors.push(...cached)
      start += batch.length
      continue
    }
    const response = await getOpenAi().embeddings.create(
      {
        model: embeddingModel.id,
        dimensions: embeddingModel.dimensions,
        input: batch,
      },
      { signal, timeout: 45_000, maxRetries: 2 },
    )
    const ordered = [...response.data].sort((a, b) => a.index - b.index)
    if (
      ordered.length !== batch.length ||
      ordered.some(
        (item, index) =>
          item.index !== index ||
          item.embedding.length !== embeddingModel.dimensions ||
          !item.embedding.every(Number.isFinite) ||
          !item.embedding.some((value) => value !== 0),
      )
    ) {
      await options.onUsage(response.usage.total_tokens)
      throw new Error('Embedding provider returned invalid vectors')
    }
    const batchVectors = ordered.map((item) => item.embedding)
    if (options.checkpoint)
      await options.checkpoint.write(
        inputHash,
        batchVectors,
        response.usage.total_tokens,
      )
    else await options.onUsage(response.usage.total_tokens)
    vectors.push(...batchVectors)
    tokens += response.usage.total_tokens
    start += batch.length
  }
  return { vectors, tokens }
}

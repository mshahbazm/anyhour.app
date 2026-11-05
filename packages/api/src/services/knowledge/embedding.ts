import { embed } from '../ai/llm'
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
    const response = await embed(batch, { signal })
    if (!validVectors(response.vectors, batch.length)) {
      await options.onUsage(response.tokens)
      throw new Error('Embedding provider returned invalid vectors')
    }
    const batchVectors = response.vectors
    if (options.checkpoint)
      await options.checkpoint.write(inputHash, batchVectors, response.tokens)
    else await options.onUsage(response.tokens)
    vectors.push(...batchVectors)
    tokens += response.tokens
    start += batch.length
  }
  return { vectors, tokens }
}

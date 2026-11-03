import {
  setDefaultModelProvider,
  setTracingDisabled,
  Usage,
} from '@openai/agents'
import type { AgentOutputItem, Model, ModelResponse } from '@openai/agents'

interface iPassage {
  sourceId: string
  text: string
  kind: string
}

function passages(value: unknown): iPassage[] {
  if (typeof value === 'string' && /^[\[{]/u.test(value)) {
    try {
      return passages(JSON.parse(value))
    } catch {
      return []
    }
  }
  if (Array.isArray(value)) return value.flatMap(passages)
  if (!value || typeof value !== 'object') return []
  const item = value as Record<string, unknown>
  if (
    typeof item.sourceId === 'string' &&
    typeof item.text === 'string' &&
    typeof item.kind === 'string'
  )
    return [{ sourceId: item.sourceId, text: item.text, kind: item.kind }]
  return Object.values(item).flatMap(passages)
}

function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(text).join(' ')
  if (value && typeof value === 'object' && 'text' in value)
    return text(value.text)
  return ''
}

// Preloaded only by roles.test.ts's API subprocess. Real tools, retrieval,
// authorization and persistence run unchanged; model decisions are deterministic.
const model: Model = {
  async getResponse(): Promise<ModelResponse> {
    throw new Error('Streaming expected')
  },
  async *getStreamedResponse(request) {
    yield { type: 'response_started' }
    const input = Array.isArray(request.input) ? request.input : []
    const user = [...input]
      .reverse()
      .find((item) => 'role' in item && item.role === 'user')
    const question = user && 'content' in user ? text(user.content) : ''
    const searched = input.some(
      (item) =>
        item.type === 'function_call' && item.name === 'search_knowledge',
    )
    const cited = input.some(
      (item) => item.type === 'function_call' && item.name === 'cite_sources',
    )
    const evidence = /close|weekdays/iu.test(question)
      ? passages(input).find(
          (item) =>
            item.kind === 'content' && /9 AM to \d(?::00)? PM/u.test(item.text),
        )
      : undefined
    let output: Array<
      Extract<
        AgentOutputItem,
        { role: 'assistant' } | { type: 'function_call' }
      >
    >
    if (!searched || !cited) {
      output = [
        {
          type: 'function_call',
          name: searched ? 'cite_sources' : 'search_knowledge',
          callId: crypto.randomUUID(),
          status: 'completed',
          arguments: JSON.stringify(
            searched
              ? { sourceIds: evidence ? [evidence.sourceId] : [] }
              : { question },
          ),
        },
      ]
    } else {
      const closing = evidence?.text.match(/9 AM to (\d(?::00)? PM)/u)?.[1]
      const answer = closing
        ? `We close at ${closing} on weekdays.`
        : 'The available sources do not provide that information.'
      yield { type: 'output_text_delta', delta: answer }
      output = [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: answer }],
        },
      ]
    }
    yield {
      type: 'response_done',
      response: {
        id: crypto.randomUUID(),
        output,
        usage: new Usage({ inputTokens: 5, outputTokens: 5, totalTokens: 10 }),
      },
    }
  },
}
setTracingDisabled(true)
setDefaultModelProvider({ getModel: () => model })

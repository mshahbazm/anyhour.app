import {
  setDefaultModelProvider,
  setTracingDisabled,
  Usage,
} from '@openai/agents'
import type {
  Model,
  ModelRequest,
  ModelResponse,
  AgentOutputItem,
} from '@openai/agents'

export const chatFixture: {
  delayMs: number
  failAfterCapture: boolean
  lead?: { title: string; name?: string; email?: string; phone?: string }
  // Arguments for a hand_off call before the reply.
  handOff?: Record<string, unknown>
  // A send_blocks call before the reply: the `block` argument, sent as is.
  block?: unknown
  question?: string
  onRequest?: (input: ModelRequest['input']) => void
  onSearchResult?: (input: ModelRequest['input']) => void
} = { delayMs: 0, failAfterCapture: false }

function retrievedSourceIds(value: unknown): string[] {
  if (typeof value === 'string' && /^[\[{]/u.test(value)) {
    try {
      return retrievedSourceIds(JSON.parse(value))
    } catch {
      return []
    }
  }
  if (Array.isArray(value)) return value.flatMap(retrievedSourceIds)
  if (!value || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  return typeof object.sourceId === 'string'
    ? [object.sourceId]
    : Object.values(object).flatMap(retrievedSourceIds)
}

const fixtureModel: Model = {
  async getResponse(): Promise<ModelResponse> {
    throw new Error('Streaming expected')
  },
  async *getStreamedResponse(request: ModelRequest) {
    const fixture = { ...chatFixture }
    fixture.onRequest?.(request.input)
    yield { type: 'response_started' }
    const hasToolResult =
      Array.isArray(request.input) &&
      request.input.some((item) => item.type === 'function_call_result')
    const hasCitationCall =
      Array.isArray(request.input) &&
      request.input.some(
        (item) => item.type === 'function_call' && item.name === 'cite_sources',
      )
    if (hasToolResult && fixture.failAfterCapture)
      throw new Error('Fixture interruption after capture')
    let output: Array<
      Extract<
        AgentOutputItem,
        { role: 'assistant' } | { type: 'function_call' }
      >
    >
    if (fixture.question && !hasToolResult) {
      output = [
        {
          type: 'function_call',
          name: 'search_knowledge',
          callId: crypto.randomUUID(),
          arguments: JSON.stringify({ question: fixture.question }),
          status: 'completed',
        },
      ]
    } else if (fixture.question && hasToolResult && !hasCitationCall) {
      fixture.onSearchResult?.(request.input)
      output = [
        {
          type: 'function_call',
          name: 'cite_sources',
          callId: crypto.randomUUID(),
          arguments: JSON.stringify({
            sourceIds: [...new Set(retrievedSourceIds(request.input))].slice(
              0,
              1,
            ),
          }),
          status: 'completed',
        },
      ]
    } else if (fixture.handOff && !hasToolResult) {
      output = [
        {
          type: 'function_call',
          name: 'hand_off',
          callId: crypto.randomUUID(),
          arguments: JSON.stringify(fixture.handOff),
          status: 'completed',
        },
      ]
    } else if (fixture.block !== undefined && !hasToolResult) {
      output = [
        {
          type: 'function_call',
          name: 'send_blocks',
          callId: crypto.randomUUID(),
          arguments: JSON.stringify({ block: fixture.block }),
          status: 'completed',
        },
      ]
    } else if (fixture.lead && !hasToolResult) {
      output = [
        {
          type: 'function_call',
          name: 'capture_lead',
          callId: crypto.randomUUID(),
          arguments: JSON.stringify(fixture.lead),
          status: 'completed',
        },
      ]
    } else {
      if (fixture.question && hasToolResult)
        fixture.onSearchResult?.(request.input)
      yield { type: 'output_text_delta', delta: 'Saved ' }
      // Intentionally ignore cancellation to exercise protection from late provider output.
      if (fixture.delayMs) await Bun.sleep(fixture.delayMs)
      yield { type: 'output_text_delta', delta: 'reply.' }
      output = [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Saved reply.' }],
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

export function installChatFixture() {
  setTracingDisabled(true)
  setDefaultModelProvider({ getModel: () => fixtureModel })
}

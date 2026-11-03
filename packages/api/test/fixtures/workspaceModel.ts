import {
  setDefaultModelProvider,
  setTracingDisabled,
  Usage,
} from '@openai/agents'
import type {
  AgentOutputItem,
  Model,
  ModelRequest,
  ModelResponse,
} from '@openai/agents'

export const workspaceFixture: {
  responseWorkflow?: Array<{ name: string; arguments: Record<string, unknown> }>
  delayMs: number
  onRequest?: (request: ModelRequest) => void | Promise<void>
} = { delayMs: 0 }
const model: Model = {
  async getResponse(): Promise<ModelResponse> {
    throw new Error('Streaming expected')
  },
  async *getStreamedResponse(request) {
    await workspaceFixture.onRequest?.(request)
    const delay = workspaceFixture.delayMs
    yield { type: 'response_started' }
    const input = Array.isArray(request.input) ? request.input : []
    let lastUser = -1
    input.forEach((item, index) => {
      if ('role' in item && item.role === 'user') lastUser = index
    })
    const item = input[lastUser]
    const content = item && 'content' in item ? item.content : ''
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((part) => ('text' in part ? part.text : '')).join('')
          : ''
    let workflow: Array<{ name: string; arguments: Record<string, unknown> }> =
      []
    if (text.startsWith('fixture:')) workflow = JSON.parse(text.slice(8))
    else workflow = workspaceFixture.responseWorkflow ?? []
    const count = input
      .slice(lastUser + 1)
      .filter((item) => item.type === 'function_call').length
    const next = workflow[count]
    let output: Array<
      Extract<
        AgentOutputItem,
        { role: 'assistant' } | { type: 'function_call' }
      >
    >
    if (next) {
      output = [
        {
          type: 'function_call',
          name: next.name,
          callId: crypto.randomUUID(),
          arguments: JSON.stringify(next.arguments),
          status: 'completed',
        },
      ]
    } else {
      yield { type: 'output_text_delta', delta: 'Workspace ' }
      if (delay) await Bun.sleep(delay)
      yield { type: 'output_text_delta', delta: 'ready.' }
      output = [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Workspace ready.' }],
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
export function installWorkspaceFixture() {
  setTracingDisabled(true)
  setDefaultModelProvider({ getModel: () => model })
}

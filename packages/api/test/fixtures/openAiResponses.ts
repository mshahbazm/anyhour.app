// A Responses API reply carrying structured output, as returned by POST /v1/responses.
export function structuredResponse(
  value: unknown,
  usage: { input: number; output: number } = { input: 1, output: 1 },
  model = 'gpt-5.6-luna',
) {
  return Response.json({
    id: `resp_${crypto.randomUUID()}`,
    object: 'response',
    created_at: 1,
    model,
    status: 'completed',
    error: null,
    incomplete_details: null,
    output: [
      {
        type: 'message',
        id: `msg_${crypto.randomUUID()}`,
        role: 'assistant',
        status: 'completed',
        content: [
          { type: 'output_text', text: JSON.stringify(value), annotations: [] },
        ],
      },
    ],
    usage: {
      input_tokens: usage.input,
      output_tokens: usage.output,
      total_tokens: usage.input + usage.output,
    },
  })
}

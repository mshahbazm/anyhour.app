import { expect, test } from 'bun:test'
import { buildWorkspaceTools } from '../../src/services/workspaceAgent/tools'

test('workspace tool schemas avoid unsupported URI formats while routes validate URLs', () => {
  const tools = buildWorkspaceTools({
    headers: new Headers(),
    dispatch: () => new Response(),
    chatId: 'schema',
    messageId: 'schema',
    signal: new AbortController().signal,
    emit: () => undefined,
  })
  // A live Responses request rejected format:uri. Fixture models bypass provider schema validation.
  const compatibleFormats = new Set([
    'date-time',
    'time',
    'date',
    'duration',
    'email',
    'hostname',
    'ipv4',
    'ipv6',
    'uuid',
  ])
  function inspect(value: unknown) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach(inspect)
      return
    }
    const object = value as Record<string, unknown>
    if (typeof object.format === 'string')
      expect(compatibleFormats.has(object.format)).toBe(true)
    Object.values(object).forEach(inspect)
  }
  tools.forEach((item) => inspect(item.parameters))
})

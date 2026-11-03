import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { classifyPageBlocks } from '../../src/services/knowledge/cleanup/classifyBlocks'
import {
  jevModel,
  type makeJevRequest,
} from '../../src/services/knowledge/cleanup/jevRequests'
import type {
  iCleanupCheckpoint,
  iPageBlock,
} from '../../src/services/knowledge/cleanup/types'

test('nested cleanup splits resume saved child decisions and the same pending usage identity', async () => {
  const page = {
    url: 'https://example.com/usage',
    title: 'Nested usage recovery',
  }
  const blocks: iPageBlock[] = [
    {
      id: 'fact',
      text: 'abcdefgh'.repeat(32),
      heading: '',
      region: 'main',
      links: [],
    },
  ]
  let saved: iCleanupCheckpoint | undefined
  let failAccounting = true
  const paidTargets = new Map<string, number>()
  const usageCalls: string[] = []
  const accounted = new Set<string>()
  const save = async (state: iCleanupCheckpoint) => {
    saved = structuredClone(state)
  }
  const send = async (request: ReturnType<typeof makeJevRequest>) => {
    const target = Object.keys(request.questions)[0]
    // Two successive context rejections force nested subdivision of one
    // fragment. Successful grandchildren must survive a failed usage callback.
    if (!/s\d+s\d+$/u.test(target))
      return new Response('Input exceeds maximum context limit', {
        status: 422,
      })
    paidTargets.set(target, (paidTargets.get(target) ?? 0) + 1)
    return Response.json({
      model: jevModel,
      answers: {
        [target]: {
          type: 'choice',
          choice: 'knowledge',
          confidence: 0.99,
          probabilities: {
            knowledge: 0.97,
            action: 0.01,
            noise: 0.01,
            uncertain: 0.01,
          },
        },
      },
      usage: { input_tokens: 10, output_tokens: 2 },
    })
  }
  const usage = async (
    _input: number,
    _output: number,
    _attempt: number,
    eventId: string,
  ) => {
    usageCalls.push(eventId)
    accounted.add(eventId)
    if (failAccounting) {
      failAccounting = false
      throw new Error('Usage acknowledgement lost after insert')
    }
  }
  await assert.rejects(
    classifyPageBlocks(page, blocks, { save, send, usage }),
    /Usage acknowledgement lost/,
  )
  assert(saved?.pendingUsage)
  const pendingId = saved.pendingUsage.id
  assert.equal(paidTargets.size, 1)
  const result = await classifyPageBlocks(page, blocks, {
    checkpoint: structuredClone(saved),
    save,
    send,
    usage,
  })
  assert.deepEqual(usageCalls.slice(0, 2), [pendingId, pendingId])
  assert.equal(paidTargets.size, 4)
  assert.ok(
    [...paidTargets.values()].every((count) => count === 1),
    'Successful child responses must not be requested again',
  )
  assert.equal(accounted.size, 4)
  assert.equal(result.checkpoint.inputTokens, 40)
  assert.equal(result.checkpoint.outputTokens, 8)
  assert.equal(result.checkpoint.pendingUsage, undefined)
  assert.equal(result.checkpoint.complete, true)
  assert.deepEqual(result.blocks, blocks)
})

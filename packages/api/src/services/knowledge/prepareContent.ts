import { decisionsConfigured, type iDecisionUsage } from '../ai/decisions'
import { classifyPageBlocks } from './cleanup/classifyBlocks'
import { extractPageBlocks } from './cleanup/extractBlocks'
import { formatBlocks } from './cleanup/formatBlocks'
import type { iCleanupCheckpoint } from './cleanup/types'
import type { iStagedPage } from './staging'

export async function preparePageContent(
  page: iStagedPage,
  save: (checkpoint: iCleanupCheckpoint) => Promise<void> = async () => {},
  usage?: (
    usage: iDecisionUsage,
    attempt: number,
    eventId: string,
  ) => Promise<void>,
) {
  const extracted = page.blocks
    ? { title: page.title, blocks: page.blocks }
    : extractPageBlocks(page)
  if (!extracted.blocks.length) throw new Error('Page has no usable content')
  const result = decisionsConfigured()
    ? await classifyPageBlocks(
        { url: page.url, title: extracted.title },
        extracted.blocks,
        { checkpoint: page.cleanup, save, usage },
      )
    : {
        blocks: extracted.blocks,
        checkpoint: {
          decisions: {},
          attempts: 0,
          activeMs: 0,
          complete: false,
          reason: 'unconfigured',
          inputTokens: 0,
          outputTokens: 0,
        } satisfies iCleanupCheckpoint,
      }
  return {
    title: extracted.title,
    text: formatBlocks(result.blocks),
    blocks: result.blocks,
    cleanup: result.checkpoint,
  }
}

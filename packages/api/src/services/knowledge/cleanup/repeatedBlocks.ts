import { createHash } from 'node:crypto'
import type { iPageBlock, iSharedText } from './types'
import { formatBlock, formatBlocks } from './formatBlocks'

export function sharedBlockKey(block: iPageBlock) {
  if (block.region === 'main' && !block.links.length) return null
  const normalized = {
    text: formatBlock(block).normalize('NFKC').replace(/\s+/gu, ' ').trim(),
    region: block.region,
    heading: block.heading.normalize('NFKC').replace(/\s+/gu, ' ').trim(),
    links: block.links.map((l) => l.url),
  }
  // Chrome heading context is deliberately local to its region, not the preceding article.
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}
export function groupRepeatedBlocks(
  pages: { sourceId: string; blocks: iPageBlock[] }[],
) {
  const occurrences = new Map<string, Set<string>>()
  for (const page of pages)
    for (const block of page.blocks) {
      const key = sharedBlockKey(block)
      if (key) {
        const sources = occurrences.get(key) ?? new Set<string>()
        sources.add(page.sourceId)
        occurrences.set(key, sources)
      }
    }
  return new Map(
    pages.map((page) => {
      const shared: iSharedText[] = [],
        specific: iPageBlock[] = []
      for (const block of page.blocks) {
        const key = sharedBlockKey(block)
        if (key && (occurrences.get(key)?.size ?? 0) > 1) {
          if (!shared.some((b) => b.key === key))
            shared.push({
              key,
              text: formatBlocks([block]),
            })
        } else specific.push(block)
      }
      return [page.sourceId, { shared, specific }]
    }),
  )
}

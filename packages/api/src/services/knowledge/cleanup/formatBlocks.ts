import { createHash } from 'node:crypto'
import type { iPageBlock } from './types'

export const knowledgeFormatVersion = 'links-v3'

export function isCurrentContentHash(hash: string | null | undefined) {
  return hash?.startsWith(`${knowledgeFormatVersion}:`) ?? false
}

export function contentHash(title: string, text: string) {
  return `${knowledgeFormatVersion}:${createHash('sha256')
    .update(JSON.stringify([title, text]))
    .digest('hex')}`
}

const escapeText = (text: string) =>
  text.replace(/&/gu, '&amp;').replace(/[\\`*_[\]<>!]/gu, '\\$&')

export function formatBlock(block: iPageBlock) {
  if (!block.inlineParts) return block.text // Text/Markdown documents retain their format.
  return block.inlineParts
    .map((part) => {
      const text = part.text.replace(/\s+/gu, ' ')
      if (!part.url || !text.trim()) return escapeText(text)
      // Angle-delimited destinations preserve parentheses, queries and fragments.
      const url = part.url
        .replace(/&/gu, '&amp;')
        .replace(/\\/gu, '\\\\')
        .replace(/</gu, '%3C')
        .replace(/>/gu, '%3E')
      const before = text.startsWith(' ') ? ' ' : ''
      const after = text.endsWith(' ') ? ' ' : ''
      return `${before}[${escapeText(text.trim())}](<${url}>)${after}`
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function formatBlocks(blocks: iPageBlock[]) {
  // Separate blocks so chunking can favor their boundaries. Repeat local headings
  // on body blocks so an action keeps its meaning when it starts a new chunk.
  return blocks
    .map((block) => {
      const text = formatBlock(block)
      return block.heading && block.heading !== block.text
        ? `${escapeText(block.heading)}\n${text}`
        : text
    })
    .join('\n\n')
}

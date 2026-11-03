import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { iInlinePart, iPageBlock } from './types'

const boundaryTags = new Set([
  'button',
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'div',
  'dl',
  'dt',
  'dd',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tr',
  'ul',
])
const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim()

export function extractPageBlocks(input: {
  html?: string
  markdown?: string
  title: string
  url: string
}) {
  if (!input.html)
    return {
      title: input.title || input.url,
      blocks: (input.markdown ?? '')
        .split(/\n\s*\n/u)
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text, i): iPageBlock => ({
          id: `b${i}`,
          text,
          heading: '',
          region: 'main',
          links: [],
        })),
    }
  const $ = cheerio.load(input.html)
  let baseUrl = input.url
  try {
    const base = new URL(
      $('base[href]').first().attr('href') ?? input.url,
      input.url,
    )
    if (['http:', 'https:'].includes(base.protocol)) baseUrl = base.href
  } catch {
    /* An invalid base does not invalidate the page's links. */
  }
  $('script,style,noscript,template,svg,canvas').remove()
  const blocks: iPageBlock[] = []
  let heading = ''
  let text = ''
  let inlineParts: iInlinePart[] = []
  let links: iPageBlock['links'] = []
  let enclosingLinks: iPageBlock['links'] = []
  let region: iPageBlock['region'] = 'main'
  const append = (value: string) => {
    text += value
    if (value.trim())
      for (const link of enclosingLinks)
        if (
          !links.some(
            (existing) =>
              existing.url === link.url && existing.label === link.label,
          )
        )
          links.push(link)
    const url = enclosingLinks.at(-1)?.url
    const previous = inlineParts.at(-1)
    if (previous && previous.url === url) previous.text += value
    else inlineParts.push({ text: value, ...(url ? { url } : {}) })
  }
  const flush = () => {
    const value = normalize(text)
    if (value)
      blocks.push({
        id: `b${blocks.length}`,
        text: value,
        heading,
        region,
        links: [...links],
        inlineParts,
      })
    text = ''
    inlineParts = []
    links = []
  }
  const walk = (node: AnyNode, inherited: iPageBlock['region']) => {
    if (node.type === 'text') {
      append(node.data)
      return
    }
    if (!('tagName' in node)) {
      if ('children' in node)
        for (const child of node.children) walk(child, inherited)
      return
    }
    const tag = node.tagName.toLowerCase()
    const role = $(node).attr('role')
    const current =
      tag === 'footer' || role === 'contentinfo'
        ? 'footer'
        : tag === 'nav' || role === 'navigation'
          ? 'navigation'
          : tag === 'aside' || role === 'complementary'
            ? 'sidebar'
            : tag === 'header' || role === 'banner'
              ? 'header'
              : inherited
    const boundary = boundaryTags.has(tag) || current !== region
    if (boundary) flush()
    const previousHeading = heading
    const previousLinks = enclosingLinks
    if (current !== inherited) heading = ''
    region = current
    if (/^h[1-6]$/u.test(tag)) heading = normalize($(node).text())
    if (tag === 'a') {
      const href = $(node).attr('href')
      if (href)
        try {
          const url = new URL(href, baseUrl)
          if (['https:', 'http:', 'tel:', 'mailto:'].includes(url.protocol))
            enclosingLinks = [
              ...enclosingLinks,
              {
                label: normalize(
                  normalize($(node).text()) ||
                    normalize($(node).attr('aria-label') ?? '') ||
                    normalize(
                      $(node)
                        .find('img')
                        .map((_, img) => $(img).attr('alt') ?? '')
                        .get()
                        .join(' '),
                    ) ||
                    '',
                ),
                url: url.href,
              },
            ]
        } catch {
          /* An invalid destination cannot become a routing action. */
        }
    }
    if (tag === 'td' || tag === 'th') append(' | ')
    if (tag === 'img') {
      append(` ${$(node).attr('alt') ?? ''} `)
    }
    if (tag === 'a') append(' ')
    for (const child of node.children) walk(child, current)
    if (
      tag === 'a' &&
      !normalize($(node).text()) &&
      !$(node)
        .find('img')
        .toArray()
        .some((img) => normalize($(img).attr('alt') ?? ''))
    ) {
      const label = $(node).attr('aria-label')
      if (label) append(label)
    }
    if (boundary) flush()
    if (current !== inherited) heading = previousHeading
    enclosingLinks = previousLinks
    if (tag === 'a') append(' ')
    region = inherited
  }
  for (const node of $('body').contents().toArray()) walk(node, 'main')
  flush()
  return {
    title: normalize($('title').first().text()) || input.title || input.url,
    blocks,
  }
}

interface iTextUnit {
  text: string
  separator: string
  words: number
}

function linkTail(value: string, start: number) {
  let i = start
  while (/\s/u.test(value[i] ?? '') && i < value.length) i++
  if (value[i] === ')') return i + 1
  const quote = value[i]
  if (quote !== '"' && quote !== "'" && quote !== '(') return -1
  const closing = quote === '(' ? ')' : quote
  for (i++; i < value.length; i++) {
    if (value[i] === '\\') {
      i++
      continue
    }
    if (value[i] === closing) {
      i++
      while (/\s/u.test(value[i] ?? '') && i < value.length) i++
      return value[i] === ')' ? i + 1 : -1
    }
  }
  return -1
}

// Index delimiters once so unmatched/nested brackets do not repeatedly scan the
// rest of a large document. Unmatched literal text is not an oversized link.
function linkDelimiters(value: string) {
  const labels = new Map<number, number>()
  const angles = new Map<number, number>()
  const parentheses = new Map<number, number>()
  const openParentheses: number[] = []
  const brackets: number[] = []
  let openAngles: number[] = []
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\') {
      i++
      continue
    }
    if (value[i] === '[') brackets.push(i)
    if (value[i] === ']') {
      const start = brackets.pop()
      if (start !== undefined) labels.set(start, i)
    }
    if (value[i] === '(') openParentheses.push(i)
    if (value[i] === ')') {
      const start = openParentheses.pop()
      if (start !== undefined) parentheses.set(start, i)
    }
    if (value[i] === '<') openAngles.push(i)
    if (value[i] === '>') {
      for (const start of openAngles) angles.set(start, i)
      openAngles = []
    }
  }
  return { labels, angles, parentheses }
}

// Scan inline Markdown links, including escaped labels and URL parentheses.
// HTML evidence uses angle-delimited destinations; these stay atomic in chunks.
function linkEnd(
  value: string,
  start: number,
  delimiters: ReturnType<typeof linkDelimiters>,
) {
  const labelEnd = delimiters.labels.get(start)
  if (labelEnd === undefined || value[labelEnd + 1] !== '(') return -1
  let i = labelEnd + 2
  while (i < value.length && /\s/u.test(value[i])) i++
  if (value[i] === '<') {
    const end = delimiters.angles.get(i)
    return end === undefined ? -1 : linkTail(value, end + 1)
  }
  for (; i < value.length; i++) {
    if (value[i] === '\\') {
      i++
      continue
    }
    if (/\s/u.test(value[i])) return linkTail(value, i)
    if (value[i] === ')') return i + 1
    if (value[i] === '(') {
      const end = delimiters.parentheses.get(i)
      if (end === undefined) return -1
      i = end
    }
  }
  return -1
}

function textUnits(value: string): iTextUnit[] {
  const units: iTextUnit[] = []
  const delimiters = linkDelimiters(value)
  let separator = ''
  for (let i = 0; i < value.length;) {
    if (/\s/u.test(value[i])) {
      separator += value[i++]
      continue
    }
    const end = linkEnd(value, i, delimiters)
    if (end !== -1) {
      const text = value.slice(i, end)
      units.push({ text, separator, words: text.split(/\s+/u).length })
      i = end
      separator = ''
      continue
    }
    let text = ''
    let points = 0
    while (i < value.length && !/\s/u.test(value[i]) && points < 1000) {
      if (text && value[i] === '[' && linkEnd(value, i, delimiters) !== -1)
        break
      const point = String.fromCodePoint(value.codePointAt(i)!)
      text += point
      i += point.length
      points++
      // An escaped bracket is literal text, not a link opener.
      if (point === '\\' && i < value.length) {
        const escaped = String.fromCodePoint(value.codePointAt(i)!)
        text += escaped
        i += escaped.length
      }
    }
    units.push({ text, separator, words: 1 })
    separator = ''
  }
  return units
}

export function chunkText(value: string, title: string) {
  const units = textUnits(value)
  const heading = Array.from(title).slice(0, 200).join('')
  const capacity = 6000 - Buffer.byteLength(heading, 'utf8') - 1
  for (const unit of units)
    if (Buffer.byteLength(unit.text, 'utf8') > capacity)
      throw new Error(
        'A knowledge link exceeds the chunk byte limit; its destination cannot be truncated',
      )
  const chunks: string[] = []
  for (let start = 0; start < units.length;) {
    let end = start,
      bytes = 0,
      words = 0,
      boundary = -1
    while (end < units.length) {
      const unit = units[end]
      const separator = end === start ? '' : unit.separator
      const size = Buffer.byteLength(separator + unit.text, 'utf8')
      if (end > start && (bytes + size > capacity || words + unit.words > 300))
        break
      if (end > start && /\n\s*\n/u.test(separator)) boundary = end
      bytes += size
      words += unit.words
      end++
    }
    // Prefer a complete block when the limit would otherwise split it. Avoid
    // making tiny chunks merely because a short heading precedes a large block.
    if (end < units.length && boundary > start + (end - start) / 2)
      end = boundary
    chunks.push(
      `${heading}\n${units
        .slice(start, end)
        .map((unit, i) => `${i ? unit.separator : ''}${unit.text}`)
        .join('')}`,
    )
    const overlap = Math.min(40, Math.floor((end - start) * 0.15))
    start = end === units.length ? end : end - overlap
  }
  return chunks
}

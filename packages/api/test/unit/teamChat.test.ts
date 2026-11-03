import { expect, test } from 'bun:test'
import {
  chunksFor,
  formatFor,
  splitText,
} from '../../src/services/teamChat/format'

test('replies are formatted per app', () => {
  const reply =
    '## Today\n**3 leads** need you. See [the board](https://example.com/leads?a=1&b=2).\n- Ana\n- Ben\n\n| Name | Stage |\n| --- | --- |\n| Ana | New |'
  expect(formatFor('whatsapp', reply)).toBe(
    'Today\n3 leads need you. See the board: https://example.com/leads?a=1&b=2.\n• Ana\n• Ben\n\nName · Stage\nAna · New',
  )
  expect(formatFor('slack', reply)).toBe(
    '*Today*\n*3 leads* need you. See <https://example.com/leads?a=1&amp;b=2|the board>.\n• Ana\n• Ben\n\nName · Stage\nAna · New',
  )
  // Visitor or model text can't inject Slack markup.
  expect(formatFor('slack', 'a <@U123> & <!channel>')).toBe(
    'a &lt;@U123&gt; &amp; &lt;!channel&gt;',
  )
})

test('long replies are split at boundaries within each app’s limit', () => {
  const paragraph = 'word '.repeat(300).trim()
  const text = [paragraph, paragraph, paragraph].join('\n\n')
  for (const app of ['whatsapp', 'slack'] as const) {
    const limit = { whatsapp: 4_096, slack: 2_900 }[app]
    const parts = chunksFor(app, text)
    expect(parts.every((part) => part.length <= limit)).toBe(true)
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '))
  }
  // Past the last part the rest is cut, never sent as a flood.
  const parts = splitText('x'.repeat(10_000), 1_000, 3)
  expect(parts.length).toBe(3)
  expect(parts[2].endsWith('…')).toBe(true)
  expect(parts.every((part) => part.length <= 1_000)).toBe(true)
})

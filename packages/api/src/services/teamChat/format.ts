import { teamChatConfig, type tTeamChatApp } from '../../config/teamChat.config'

// The owner assistant writes light Markdown for the dashboard. Each chat app
// gets its own dialect, and long replies are split to its length limit.

// Markdown tables become one line per row: no app here shows tables well.
function untable(text: string) {
  return text
    .split('\n')
    .filter(
      (line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line),
    )
    .map((line) =>
      /^\s*\|.*\|\s*$/.test(line)
        ? line
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((cell) => cell.trim())
            .filter(Boolean)
            .join(' · ')
        : line,
    )
    .join('\n')
}

const plainText = (text: string) =>
  untable(text)
    .replace(/^#{1,6}\s+(.*)$/gm, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`{3}[a-z]*\n?([\s\S]*?)`{3}/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1: $2')
    .replace(/^\s*[-*]\s+/gm, '• ')

// Slack mrkdwn: *bold*, <url|text>, and &, <, > escaped.
const slackText = (text: string) =>
  untable(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^#{1,6}\s+(.*)$/gm, '*$1*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<$2|$1>')
    .replace(/^\s*[-*]\s+/gm, '• ')

export function formatFor(app: tTeamChatApp, text: string) {
  const formatted = app === 'slack' ? slackText(text) : plainText(text)
  return formatted.replace(/\n{3,}/g, '\n\n').trim()
}

// Splits at paragraph, then line, then word boundaries so each part fits
// the app's limit. Past maxChunks the rest is cut with an ellipsis.
export function splitText(
  text: string,
  limit: number,
  maxChunks = teamChatConfig.maxChunks,
) {
  const parts: string[] = []
  let rest = text.trim()
  while (rest.length > limit && parts.length < maxChunks - 1) {
    const window = rest.slice(0, limit)
    const cut = [
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('\n'),
      window.lastIndexOf(' '),
    ].find((index) => index > limit * 0.5)
    const at = cut ?? limit
    parts.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }
  if (rest)
    parts.push(
      rest.length > limit ? `${rest.slice(0, limit - 1).trimEnd()}…` : rest,
    )
  return parts
}

export function chunksFor(app: tTeamChatApp, text: string) {
  return splitText(formatFor(app, text), teamChatConfig.textLimits[app])
}

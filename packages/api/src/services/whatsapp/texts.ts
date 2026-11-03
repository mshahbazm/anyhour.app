import {
  leadDisplayName,
  leadUrl,
  recentLeadMessages,
  type tLeadView,
} from '../leads/leadView'
import { describeQualification } from '../leads/qualify'

// What the owner reads on their phone: who it is, what they said and where
// to open it. Visitor text is quoted, clipped and kept to plain lines.

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

const clip = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text

const quote = (text: string, limit = 280) => `“${clip(oneLine(text), limit)}”`

// "Ana Baker (ana@example.com)"
function who(view: tLeadView) {
  const name = leadDisplayName(view)
  const detail = [view.contactEmail, view.contactPhone].find(
    (item) => item && item !== name,
  )
  return clip(oneLine(detail ? `${name} (${detail})` : name), 160)
}

// The lead's latest message to the bot, or the summary from qualification.
async function whatTheySaid(view: tLeadView) {
  const messages = await recentLeadMessages(view.lead.id, 10)
  const latest = messages.filter((item) => item.role === 'visitor').at(-1)
  const said = latest?.text || view.lead.summary
  return said ? `They said: ${quote(said)}` : null
}

function qualificationLine(view: tLeadView) {
  const record = view.lead
  if (!record.intent || record.score === null || !record.qualification)
    return null
  return describeQualification({
    score: record.score,
    fit: record.qualification.fit,
    intent: record.intent,
  })
}

// A new lead was captured.
export async function leadAlertText(view: tLeadView) {
  return [
    `New lead: ${who(view)}`,
    clip(oneLine(view.lead.title), 200),
    await whatTheySaid(view),
    qualificationLine(view),
    '',
    `Open it: ${leadUrl(view.lead.id)}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

export const connectedText = (employeeName: string | null) =>
  `Connected. ${employeeName ? `I’m ${employeeName}: m` : 'M'}essage me here as you would in the dashboard, and I’ll message you when something needs you.`

export const testText = (employeeName: string | null) =>
  `${employeeName ? `${employeeName} here: t` : 'T'}his is a test. I’ll message you here when something needs you.`

import type { tTeamChatApp } from '../../config/teamChat.config'

// One adapter per chat app, one brain (docs/teamChat.md). Every app turns
// what a team member wrote into an iTeamMessage for the owner assistant
// (turn.ts) and delivers its iTeamReply in the app's own format: WhatsApp
// plain text with an exact "yes", Slack mrkdwn with buttons.

/** A question the AI is waiting on: a confirmation or a choice. */
export interface iTeamChoice {
  blockId: string
  title: string
  description: string | null
  options: Array<{ value: string; label: string }>
  /** A hard-to-undo action: only a button or an exact "yes" confirms it. */
  confirmsAction: boolean
}

export interface iTeamReply {
  /** Light Markdown, as the assistant wrote it; adapters format it. */
  text: string
  choices: iTeamChoice[]
}

export interface iTeamMessage {
  app: tTeamChatApp
  memberId: string
  /** The app's id for the message, so a redelivery is handled once. */
  externalMessageId: string
  text: string
  /** A tapped button. */
  choice: { blockId: string; value: string } | null
  /** The alert or message this replies to, quoted as data for the AI. */
  quoted: string | null
}

export interface iTeamChatAdapter<tTarget> {
  app: tTeamChatApp
  /** Sends a reply or an alert, formatted and split for the app. */
  send(target: tTarget, reply: iTeamReply): Promise<void>
  /** The only answer an unlinked person gets. WhatsApp links by "hi". */
  sendLinkPrompt?(target: tTarget, url: string): Promise<void>
}

// The one line an app without buttons shows under a choice.
export function choiceHint(choice: iTeamChoice) {
  if (choice.confirmsAction) return 'Reply yes to confirm, or cancel.'
  return `Reply with one of: ${choice.options.map((item) => item.label).join(', ')}.`
}

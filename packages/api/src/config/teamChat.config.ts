// Employees in the team's chat apps (docs/teamChat.md): WhatsApp (Agent
// Platform) and Slack. Not `as const`: integration tests point the
// API URLs at fake servers.

export const teamChatApps = ['whatsapp', 'slack'] as const
export type tTeamChatApp = (typeof teamChatApps)[number]

export const teamChatAppNames: Record<tTeamChatApp, string> = {
  whatsapp: 'WhatsApp',
  slack: 'Slack',
}

export const teamChatConfig: {
  slackApiUrl: string
  slackAuthorizeUrl: string
  requestTimeoutMs: number
  slackScopes: string[]
  installStateMinutes: number
  linkMinutes: number
  staleMinutes: number
  slackSignatureSeconds: number
  textLimits: Record<tTeamChatApp, number>
  maxChunks: number
  maxButtons: number
  messagesPerMinute: number
  keepEventsDays: number
  pruneBatch: number
} = {
  slackApiUrl: 'https://slack.com/api',
  slackAuthorizeUrl: 'https://slack.com/oauth/v2/authorize',
  requestTimeoutMs: 10_000,
  // DMs, @mentions, replying, and listing channels for the alerts channel.
  slackScopes: [
    'app_mentions:read',
    'channels:read',
    'chat:write',
    'groups:read',
    'im:history',
    'im:read',
    'im:write',
  ],
  installStateMinutes: 15,
  // A "Link your account" link works once, for this long.
  linkMinutes: 30,
  // Messages older than this are never acted on (as on WhatsApp).
  staleMinutes: 15,
  // Slack's replay window for a signed request.
  slackSignatureSeconds: 300,
  // Characters per message: WhatsApp's text limit, a Slack section block's
  // (with room for escaping).
  textLimits: { whatsapp: 4_096, slack: 2_900 },
  // A long reply is split into at most this many messages.
  maxChunks: 4,
  // Buttons shown for one confirmation or choice.
  maxButtons: 5,
  // WhatsApp lets each person create up to 5 agents.
  // Messages one person may send their employees a minute, across apps.
  messagesPerMinute: 20,
  keepEventsDays: 30,
  pruneBatch: 1_000,
}

// Owner-chat tools that are hard to undo. From a chat app they never run
// straight away: the employee shows a confirmation, and only a button tap or
// an exact "yes" runs the stored action (services/workspaceAgent/tools.ts).
export const confirmFirstTools: Record<
  string,
  { title: string; detail?: (input: Record<string, unknown>) => unknown }
> = {
  reply_to_conversation: {
    title: 'Send this reply to the visitor?',
    detail: (input) => input.text,
  },
  delete_member_rule: { title: 'Remove this rule?' },
  remove_knowledge_note: { title: 'Remove this note?' },
  forget_contact_fact: { title: 'Forget this about the contact?' },
  invite_member: {
    title: 'Send this invitation?',
    detail: (input) =>
      typeof input.email === 'string'
        ? `${input.email} as ${String(input.role)}`
        : null,
  },
  update_member_role: {
    title: 'Change their role?',
    detail: (input) => (input.role ? `New role: ${String(input.role)}` : null),
  },
  cancel_invitation: { title: 'Cancel this invitation?' },
}

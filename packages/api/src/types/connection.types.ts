// GET /api/organizations/:organizationId/connections: the team chat app,
// the business's WhatsApp number and its website chat channels. Credentials are never returned.
export interface iConnectionView {
  id: string
  provider: 'slack' | 'whatsapp_business' | 'website'
  /** Slack team, WhatsApp phone number id, the website's origin. */
  externalAccountId: string
  status: 'pending' | 'active' | 'broken' | 'disconnected'
  /** The Slack workspace, or WhatsApp's verified name. */
  accountName: string | null
  alertsChannelId: string | null
  alertsChannelName: string | null
  /** WhatsApp Business: the number customers write to. */
  phoneNumber: string | null
  /** WhatsApp Business: the template for replies after 24 hours. */
  templateName: string | null
  lastError: string | null
  linkedMembers: number
  /** Whether the person asking linked their own account. */
  youLinked: boolean
  /** Website: whether the chat code was seen loading there. */
  installStatus: 'working' | 'notAllowed' | 'notLive' | null
  /** Website: when the chat code was last seen there. */
  lastSeenAt: string | null
  createdAt: string
}

export interface iConnectionList {
  /** Whether our app is set up for each provider (env); false shows "Not available yet". */
  available: {
    slack: boolean
    whatsappBusiness: boolean
  }
  connections: iConnectionView[]
}

// PATCH .../connections/:connectionId: the changed connection, plus the
// whole list the older cards replace theirs with.
export type tUpdatedConnection = iConnectionView & iConnectionList

// GET .../connections/:connectionId/channels: where alerts can go.
export interface iConnectionChannel {
  id: string
  name: string
}

// GET/POST /api/team-chat/links/:token: the "Link your account" page.
export interface iTeamChatLink {
  app: 'slack'
  appName: string
  accountName: string | null
  workspaceName: string
  /** The AI's name. */
  employeeName: string | null
}

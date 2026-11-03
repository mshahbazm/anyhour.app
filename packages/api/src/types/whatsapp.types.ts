// GET/POST /api/organizations/:organizationId/whatsapp: personal WhatsApp
// agents, one per person, talking as the AI. An agent's key is never
// returned.
export interface iWhatsappAgentView {
  id: string
  status: 'waiting_for_hi' | 'linked' | 'broken'
  memberId: string | null
  memberName: string | null
  /** The person asking: they manage it from their phone. */
  mine: boolean
  linkedAt: string | null
  lastError: string | null
}

export interface iWhatsappAgents {
  /** Yours first, then (for owners and admins) your team's. */
  agents: iWhatsappAgentView[]
}

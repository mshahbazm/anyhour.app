import { api } from '../workspace/api'

// One line of a lead's timeline: what happened, and who did it.
export type tLeadActivityKind =
  | 'captured'
  | 'status_changed'
  | 'note_added'
  | 'email_received'
  | 'owner_notified'
  | 'qualified'
  | 'contact_added'
  | 'contact_removed'
  | 'contact_role_changed'
  | 'contacts_merged'

export interface iLeadActivity {
  id: string
  /** Kept open: older entries and newer servers may log other kinds. */
  kind: tLeadActivityKind | (string & {})
  title: string
  detail: Record<string, unknown> | null
  actorMemberId: string | null
  createdAt: string
}

const leadPath = (organizationId: string, leadId: string) =>
  `/api/organizations/${organizationId}/leads/${encodeURIComponent(leadId)}`

export const listLeadActivity = (
  organizationId: string,
  leadId: string,
  before?: string,
) =>
  api<{ activities: iLeadActivity[]; nextBefore: string | null }>(
    `${leadPath(organizationId, leadId)}/activity${before ? `?before=${encodeURIComponent(before)}` : ''}`,
  )

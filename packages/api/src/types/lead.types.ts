// HTTP contracts for a lead's timeline.

export interface iLeadActivity {
  id: string
  kind: string
  title: string
  detail: Record<string, unknown> | null
  actorMemberId: string | null
  createdAt: string
}

export interface iLeadActivityList {
  activities: iLeadActivity[]
  // Pass as `before` for the next page; null on the last one.
  nextBefore: string | null
}

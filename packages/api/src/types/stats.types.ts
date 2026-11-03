// GET /organizations/:organizationId/stats/month: what the AI did for the
// workspace this calendar month (UTC), for the first page after sign-in.
export interface iMonthStats {
  // First day of the month, YYYY-MM-DD.
  monthStart: string
  // Non-test conversations the AI replied in this month.
  customersAnswered: number
  // Of those, how many started outside opening hours (read from Your
  // business), in the workspace's time zone; 18:00–08:00 and weekends while
  // the hours are unknown, UTC while the time zone is.
  outsideHours: number
  // Leads the AI caught in chat this month.
  leadsCaught: number
  // Those leads marked won this month, and what they were worth in minor
  // units (cents).
  leadsWon: number
  wonValue: number
  // Conversations the AI handed to a person this month.
  neededYou: number
  // Notes saved from a person's reply (answers learned) this month.
  answersLearned: number
  // The website funnel this month: visitors (website insights; null while
  // visitor counts, or their visits option, are off) → visitors who chatted
  // (non-test website conversations started) → leadsCaught → leadsWon.
  websiteVisitors: number | null
  visitorsChatted: number
}

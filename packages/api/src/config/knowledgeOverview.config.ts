// A bot's overall picture of the business, derived from everything it has
// learned. Rebuilt when knowledge settles after a change, never edited directly.
export interface iKnowledgeOverview {
  /** What the business is and does, in two or three sentences. */
  summary: string
  /** Who it serves, when that's clear. */
  audience: string | null
  offerings: { name: string; detail: string }[]
  /** Things visitors can do, with links taken from the sources. */
  actions: { label: string; url: string }[]
  /** Websites and documents it was built from. */
  sources: string[]
  /** Questions the bot can answer well, for new visitors to tap. */
  starterQuestions: string[]
}

// Inputs are page and document profiles (already short), not full text, so a
// rebuild costs about the same for a 10-page site and a 1,000-page one.
export const knowledgeOverviewLimits = {
  profiles: 40,
  documents: 15,
  minProfilesPerWebsite: 3,
  homepageTextChars: 1500,
  otherTitles: 150,
  noteChars: 6000,
  /** Wait for knowledge to settle before rebuilding. */
  settleSeconds: 45,
  offerings: 8,
  actions: 6,
  starterQuestions: 6,
} as const

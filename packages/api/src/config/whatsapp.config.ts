// WhatsApp owner alerts through Meta's Agent Platform (docs/whatsappOwnerAlerts.md).
// Not `as const`: integration tests point apiUrl at a fake server and drop
// the spacing.
export const whatsappConfig: {
  apiUrl: string
  requestTimeoutMs: number
  sendSpacingMs: number
  pollSpacingMs: number
  longPollSeconds: number
  pollJobSeconds: number
  pollRetrySeconds: number
  pollConcurrency: number
  updatesPerPoll: number
  staleCommandMinutes: number
  maxTextChars: number
  maxErrorChars: number
} = {
  apiUrl: 'https://api.whatsapp.com/agent/v1',
  // A send or a short request gives up after this long.
  requestTimeoutMs: 10_000,
  // 12 sends and 15 polls a minute per agent.
  sendSpacingMs: 5_100,
  pollSpacingMs: 4_100,
  // One GET /updates waits up to this long (the API allows 0–25 s).
  longPollSeconds: 20,
  // A poll job keeps polling this long, then queues the next one.
  pollJobSeconds: 50,
  // After a failed poll (rate limit, WhatsApp down) the next job waits this long.
  pollRetrySeconds: 30,
  // Poll jobs one worker runs at once: each is mostly waiting on WhatsApp.
  pollConcurrency: 25,
  updatesPerPoll: 50,
  // Owner messages older than this are never acted on (also covers backlog
  // replayed on first link).
  staleCommandMinutes: 15,
  // WhatsApp's text limit.
  maxTextChars: 4_096,
  maxErrorChars: 300,
}

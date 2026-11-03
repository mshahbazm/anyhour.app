export const chatConfig = {
  generationTimeoutMs: 120_000,
}

// When a quiet conversation counts as over.
export const conversationTiming = {
  // An open conversation quiet this long is closed by the maintenance sweep,
  // which queues the contact-facts job.
  closeAfterIdleMinutes: 30,
  // Conversations one sweep closes at most.
  closeBatch: 200,
} as const

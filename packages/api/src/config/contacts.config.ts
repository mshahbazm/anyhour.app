// Contact memory (services/contacts/memory.ts): what the agent may remember
// about a contact after a conversation ends. Owner-facing only.
export const contactMemory = {
  // Facts a contact may hold; when full, the agent stops adding its own.
  maxFactsPerContact: 50,
  // New facts one ended conversation may add.
  factsPerConversation: 5,
  // A fact is one short sentence.
  factChars: 200,
  // Conversation messages the extraction reads, newest last.
  messages: 40,
  messageChars: 1000,
  // Deals given to the model so it skips what they already say.
  deals: 10,
  dealSummaryChars: 600,
  // Facts owner drafts and lead summaries quote, newest first.
  contextFacts: 20,
} as const

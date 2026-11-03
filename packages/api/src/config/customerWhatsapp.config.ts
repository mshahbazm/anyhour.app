// Customers on the business's own WhatsApp number, through Meta's Cloud API
// (docs/customerWhatsapp.md). Not `as const`: integration tests point the
// Graph API at a fake server.
export const customerWhatsappConfig: {
  graphApiUrl: string
  requestTimeoutMs: number
  windowHours: number
  maxTextChars: number
  templateTextChars: number
  sendsPerSecond: number
  maxSendWaitMs: number
  maxErrorChars: number
} = {
  graphApiUrl: 'https://graph.facebook.com/v23.0',
  requestTimeoutMs: 10_000,
  // WhatsApp's customer service window: free text only this long after the
  // customer last wrote; after it, only approved templates.
  windowHours: 24,
  // WhatsApp's text limit.
  maxTextChars: 4_096,
  // What we put in the template's one variable: one line, kept short.
  templateTextChars: 900,
  // Sends per number per second from one process, well under Meta's
  // default throughput; a burst waits its turn up to maxSendWaitMs.
  sendsPerSecond: 20,
  maxSendWaitMs: 5_000,
  maxErrorChars: 300,
}

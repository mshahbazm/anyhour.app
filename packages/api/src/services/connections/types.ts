import type {
  connection,
  iConnectionSettings,
  tConnectionProvider,
} from '../../db/schema/product/connection'

export type tConnection = typeof connection.$inferSelect

// One inbound event, as stored in connection_event.
export interface iProviderEvent {
  externalAccountId: string
  externalEventId: string
  kind: 'message' | 'action' | 'status' | 'uninstalled'
  /** Who wrote or tapped; their events are handled one at a time. */
  externalUserId: string | null
  payload: Record<string, unknown>
}

// What a webhook body turned out to be: an answer the provider waits for
// (a URL check, a ping), or events to store, then a fast ack.
export type tWebhookParse =
  { respond: Response } | { events: iProviderEvent[]; ack: Response }

export interface iConnected {
  externalAccountId: string
  settings: iConnectionSettings
  credentials: Record<string, string> | null
}

// A provider module (docs/channels.md, "Wave 3a"): install, verify and read
// webhooks, handle a stored event, and its typed outbound calls (`actions`,
// in each module).
export interface iConnectionProvider {
  id: tConnectionProvider
  /** Our app's credentials for it are set (env). */
  available(): boolean
  /** OAuth providers: where the install starts. Pasted ones have none. */
  installUrl?(state: string): string
  /** Finishes the OAuth install with the code from the callback. */
  connect?(code: string): Promise<iConnected>
  /** Answers the provider's GET check of the webhook URL (Meta's hub.challenge). */
  challenge?(query: URLSearchParams): Response
  verifyWebhook(headers: Headers, rawBody: string): boolean
  parseWebhook(headers: Headers, rawBody: string): tWebhookParse
  handleEvent(record: tConnection, event: iProviderEvent): Promise<void>
  /** Channels alerts may go to (team chat apps). */
  channels?(record: tConnection): Promise<Array<{ id: string; name: string }>>
  /** Best effort: removes our app from their side. */
  disconnect(record: tConnection): Promise<void>
}

# Channels, connectors and chat blocks

Waves 3 to 5 of the plan in [contacts.md](contacts.md), agreed with the user on 2026-10-29. Read [yourAi.md](yourAi.md), [support.md](support.md) and [whatsappOwnerAlerts.md](whatsappOwnerAlerts.md) first.

The principle throughout is **one brain, many channels**. Every channel is an adapter: it turns its input into "contact X said Y on channel C" and delivers the reply. The answering logic (knowledge, never make things up, capture, handoff, memory for the owner side) is shared, and each channel adds only its formatting rules. The inbox (wave 2) shows every channel in one list.

## Wave 3 first: your AI team in your team's chat apps (owner side)
Every AI team member can be connected to the messaging apps the owner and team already use. There they talk to it like a colleague and get its alerts. **Start with WhatsApp and Slack**; list Telegram, Microsoft Teams and Google Chat for later.

**One adapter per app, one brain.** `services/teamChat/` defines an adapter interface: link a member, receive a message (text plus a quoted or thread reference), send a reply or alert (formatted per app), and ask for confirmation. Every app feeds the same owner assistant (`services/workspaceAgent`) with the linked member's permissions, and alerts go through the existing notifier to whichever apps a member linked (email stays the fallback). The thread is stored like the dashboard chat, so the history shows across all of them.

| App | How it connects | Notes |
|---|---|---|
| WhatsApp | Agent Platform personal agents (built for alerts) | Details below |
| Slack | A Slack app. OAuth install per Slack workspace (bot token stored encrypted in `connection`), Events API webhook (signed), DMs plus @mentions in channels, and an alerts channel chosen in settings | Our Slack app's client id and secret come from env. Slack users link to a member through a one-time link the bot sends. An unlinked user gets "Link your account" and nothing else |
| Telegram, Teams, Google Chat | Later | Same adapter interface |

**Per AI team member:** a connection is linked to one AI team member, so alerts and replies speak as that AI team member; a business can link "Tom" to #sales and "Sara" to #support. **Safety:** the same rules apply on every app. Risky actions need an explicit confirmation (a button where the app has them, otherwise an exact "yes"), stale messages are ignored, secrets are never sent, and in a shared channel the bot acts with the permissions of the member who mentioned it.

### WhatsApp details (owner side)
Owners already get alerts through Meta's WhatsApp Agent Platform (personal agents, see whatsappOwnerAlerts.md). Next is the **full owner chat in WhatsApp**: the owner messages their AI team member in WhatsApp exactly as they would in the dashboard chat.
- **Free text goes to the owner assistant** (`services/workspaceAgent`) with the same tools, skills and permissions as the linked member.
  - Replies are formatted for WhatsApp: plain text, short, no tables.
  - Quoted replies to an alert give the assistant that item as context.
- **One conversation thread per linked owner**, stored like the dashboard chat (`workspaceChat` / `workspaceMessage`), so the dashboard shows what was said in WhatsApp and the reverse.
- **Safety:**
  - Changes that are hard to undo (sending a customer reply, deleting, merging) need an explicit "yes" on WhatsApp, following the existing exact-word rule.
  - Messages older than the stale cutoff are ignored.
  - Agent Platform chats aren't end-to-end encrypted, so never send secrets.
- **Several agents per owner, mapped to AI team members.** WhatsApp lets each user create up to 5 agents. A workspace can link one WhatsApp agent per AI team member, so a business with "Tom (sales)" and "Sara (support)" gets two separate WhatsApp chats, each talking as that AI team member.
  - The Tools page links an agent to an AI team member.
  - Each agent's alerts are the ones about its AI team member.
  - Workspace-wide alerts go to the first linked agent.
- **Team members** can each link their own WhatsApp agent, because an agent only talks to its creator. Each one then acts with that member's permissions.
- **Media:** a voice note from the owner is transcribed and handled as text (a later step; note it, don't build it).
- **Not for customers.** The Agent Platform can only message the agent's creator. Customer WhatsApp needs the Cloud API below.

## Wave 3a: connector framework (API)
One pattern for every outside system (customer WhatsApp, Shopify, Zendesk, and later others).

| Table | Columns |
|---|---|
| `connection` | id, organizationId, provider (`whatsapp_business \| shopify \| zendesk \| …`), status (`pending \| active \| broken \| disconnected`), externalAccountId (phone number id, shop domain, Zendesk subdomain), credentials (AES-GCM encrypted JSON, reusing the key handling in `services/whatsapp/secret.ts`; never returned to clients), settings (jsonb), lastError, lastSyncAt, timestamps. Unique (provider, externalAccountId) |
| `connection_event` | Inbound webhook log for idempotency and debugging: connectionId, externalEventId (unique per connection), kind, receivedAt, processedAt, error. Pruned like webhook deliveries |

- `services/connections/` holds a provider registry. Each provider module exports `connect`, `verifyWebhook`, `handleEvent`, `actions` (typed outbound calls) and an optional `sync`. Inbound webhooks go to `POST /api/connect/:provider/webhook`. They are verified (signature, HMAC), stored, acked fast and processed by a queue job.
- **Health:** a 401 or 403 from the provider marks the connection `broken` and alerts the owner through the existing notifier. The Tools page shows the status.
- **Permissions:** `integration:*` exists already. Credentials are never logged.
- **Page:** "My tools" lists connections with their status (connect, disconnect, reconnect).
- **Chat:** an owner tool `list_connections` to read their status. Connecting itself stays on the page, because it needs secrets and OAuth.

## Wave 3b: customer WhatsApp (WhatsApp Business Cloud API)
Built on 2026-10-30; how it works and Meta setup: [customerWhatsapp.md](customerWhatsapp.md).

This is different from the owner alerts, which use the personal Agent Platform. Customers message the **business's own WhatsApp number**, connected through Meta's WhatsApp Business Platform (Cloud API):
- **Connect:** the owner pastes a phone number id, WhatsApp Business Account id and a permanent access token (system user). Embedded Signup can replace this later. We store them encrypted, register the webhook and verify it (GET `hub.challenge` with our verify token; POST signed `X-Hub-Signature-256` with the app secret from env).
- **Inbound:** messages become `conversation` rows with `channel: 'whatsapp'`, keyed by (connection, customer wa_id). The contact is found or created through `contact_identity` kind `whatsapp`. The sender id is verified by Meta, which is the first verified identity. Note this in code, but don't yet relax the rule that facts are owner-only.
- **Reply:** the same answer pipeline as the website, with a WhatsApp playbook (short messages, no markdown headings, at most 1 link per message).
  - Within the 24-hour customer service window, send free text.
  - Outside it, only approved templates may be sent. Store a template name in settings, and when there is none, keep the reply as a draft for the owner.
  - **Process each contact's messages one at a time**, using a queue singleton per conversation, so two quick messages don't produce two parallel answers.
- **Handoff and staff replies:** the same as the widget. Staff replies in the inbox go out through the Cloud API.
- **Media:** for v1, inbound images or documents are noted ("[image]") and the AI team member asks for text. Audio is noted.
- **Delivery status:** the status webhooks update the message status.
- **Limits:** rate-limit sends per number, and log errors without tokens.

## Wave 4: chat UI blocks
An AI team member can send **typed blocks** besides text. Stored on the message as `blocks: tChatBlock[]` (jsonb, Zod-validated; the model fills them through a tool, never as raw JSON in text). Each block always has a plain-text fallback.

| Block | Widget | WhatsApp (Cloud API) | Inbox |
|---|---|---|---|
| `choices` (up to 3 quick replies) | buttons | interactive reply buttons | shown |
| `list` (up to 10 options) | option list | interactive list message | shown |
| `checklist` (items with done state, e.g. "What to bring") | checklist | numbered text | shown |
| `contactForm` (ask for email/phone) | inline mini form, feeding the existing lead capture | text question | shown |

A button tap is sent back as a visitor message carrying `{blockId, value}`, so the conversation history stays readable. The model gets a `send_blocks` tool with a strict schema and guidance in a playbook: use blocks only when they help, at most one block per reply. The owner assistant's existing `workspaceUiBlock` is separate and stays as it is.

Built 2026-10-30. A service card (from the workspace's services and offers) was removed with them on 2026-10-31. Fallback text is written by the server from the block, and the model reads past blocks as that text. A block the model gets wrong is not shown and the reply still goes out. The contact form posts to the normal message route (same limits) with the details, and records the lead through the same capture as `capture_lead`. On WhatsApp, interactive messages go out only inside the 24-hour window; outside it the template carries the reply with the block as numbered text, or the reply waits as the draft.

## Wave 5: plugins and extensions (deferred)
On 2026-10-29 the user decided to build the platform first and come back to plugins and extensions later. The WordPress plugin (`packages/wordpress`) was already built, so it stays. The Shopify app and the Zendesk connector below are **not to be built yet**; they're kept here as the plan for later.

### Wave 5a: Shopify
- **Connect:** custom app credentials pasted, or an OAuth public app. Build the OAuth flow (`/api/connect/shopify/install` and `/callback`, HMAC check, offline token), with scopes `read_products`, `read_orders`, `read_customers`.
- **Sync:** products are imported as a knowledge source (one passage per product: title, description, price, variants, URL), refreshed by a scheduled sync and the `products/update` webhook.
- **Tool:** `order_status` (an order number plus the email or phone on the order, and both must match, before anything is shown) returns status, fulfilment and tracking link. Never other customers' data.
- **Embed:** a theme app extension (app embed block) that injects the widget, in `packages/shopify` (Shopify CLI layout). Building and deploying the app needs a Shopify Partner account; document the steps.
- GDPR webhooks (customers/data_request, customers/redact, shop/redact) are required by Shopify. Implement them.

### Wave 5b: Zendesk connector
- **Connect:** subdomain plus an API token (email/token), stored encrypted.
- **Inbound:** a Zendesk webhook or trigger on "ticket created" and "end-user replied" posts to our webhook (signed).
- **Act:** the AI team member drafts a reply and posts it as an **internal note** by default. A setting allows public replies "only when sure" (the never-make-things-up rule). It adds the tag `anyhour`.
- **Learn:** Help Center articles are imported as a knowledge source.
- **Their desk owns the ticket.** We keep only a link (the connection, the Zendesk ticket id) plus our contact and memory. Mirroring full tickets is out of scope.
- A sidebar app is out of scope for now; document it as the next step.

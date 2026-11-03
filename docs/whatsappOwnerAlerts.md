# WhatsApp owner alerts

Business owners live in WhatsApp, not dashboards. When an AI employee captures a lead, gets a question it can't answer, or has a reply waiting for approval, the owner should hear about it there, and be able to answer there.

This pattern was first built and run in production for our own cold-email replies (October 2026). Use it as the reference when adding owner notifications to Anyhour.

## What the owner experiences

1. They create an agent once in their own WhatsApp (Settings → Agents → Create an agent), copy its API key, and give it to us.
2. They send the agent any message ("hi"). That links them. The agent replies "Connected".
3. From then on, the agent messages them the moment something happens. For example:
   - **Ready to send:** what the customer wrote, plus the reply we prepared. The owner answers **send** or **skip**.
   - **Needs you:** what the customer wrote, when no prepared answer fits.
   - **Done:** a one-line confirmation (sent, removed, failed).
4. They control it by chatting: **on** (autopilot while away), **off**, **status**. If several items are waiting, replying to a specific alert applies the command to that item.

It's free, it needs no app install, and no Meta Business verification or message templates.

## How it works: WhatsApp Agent Platform

Meta's developer manual: "WhatsApp Agent Platform, Developer Manual, Version 1", August 25, 2026. API base: `https://api.whatsapp.com/agent/v1`.

- **Personal agents.** Each WhatsApp user can create up to 5 agents. The API key from the agent's Chat info is a bearer token. Regenerating it, or the user reinstalling WhatsApp, invalidates it.
- **Only the creator.** An agent can message only the user who created it (`403`, code `131005`, for anyone else). This makes it perfect for owner alerts, and impossible to use for messaging customers.
- **Send:** `POST /messages` with `{"messaging_product":"whatsapp","to":"user:<id>","type":"text","text":{"body":"..."}}`. Text up to 4096 characters. Images, documents, audio and video upload through `POST /media`.
- **Receive:** long-poll `GET /updates?offset=<n>&timeout=<0–25>`. There is no webhook. Pass back `next_offset` unchanged. `204` means nothing new, so re-poll with the same offset. Run only one poll per agent at a time (`409` otherwise). Updates are kept for 30 days.
- **Owner identity.** The owner's id (`user:<id>`) comes only from their first inbound message, which is why they must send "hi" once. It is not their phone number. We never need, store or show the number. Treat the id as opaque, and use the latest `from` value, because it can change.
- **Limits:** 12 sends per minute and 15 polls per minute per agent. Chats with agents are not end-to-end encrypted, so don't send secrets through them.
- **Quoted replies.** When the owner replies to a specific alert, the inbound message carries `context.id`, the alert's message id. Store each alert's id next to the item it belongs to.

## Reference implementation

Repository `~/www/webdev`, project `cloudflare-outreach-mcp/` (a Cloudflare Worker):

| File | Role |
| --- | --- |
| `src/whatsapp.ts` | `sendToOwner` and `pollOwnerMessages`. Links the first sender as owner and stores the poll offset. |
| `src/replyDesk.ts` | Incoming event → prepared reply → WhatsApp alert. Owner commands (`send`, `skip`, `on`, `off`, `status`), autopilot and the review page. |
| `migrations/0005_reply_desk.sql`, `0006_whatsapp_agent.sql` | Event log, settings (owner id, offset, autopilot), and the alert-message id per event. |

Runtime:
- Events arrive by webhook (Smartlead there; in Anyhour it would be our own lead and conversation events) and are processed immediately.
- A cron runs every minute. It sends replies whose time has come, then long-polls WhatsApp for about 50 seconds, so owner commands take effect within roughly a minute.
- The agent token is a Worker secret (`WA_AGENT_TOKEN`). The owner id and offset live in the database.

## Rules learned in production

- **Approval by default.** Only pre-approved fixed replies may send without the owner, and only while autopilot is on. AI-written drafts always wait for "send".
- **Never act on stale commands.** Ignore owner messages older than about 15 minutes, which also covers backlog replay on first link.
- **Only exact commands act.** "send" sends. Casual words like "ok" or "yes" must not trigger anything.
- **No guessing on irreversible actions.** In the first test, a soft "no thanks, too slow" was classified as not interested and the lead was auto-unsubscribed. Only an explicit "remove me / stop emailing" may unsubscribe. Everything ambiguous goes to the owner.
- **Check the thread before sending.** If someone already replied or the customer wrote again, don't send.
- **Keep alerts readable on a phone.** Who it is, what they said, what we'll send, and one action word.

## The manual part (and how to shrink it)

Each owner currently has to create the agent in WhatsApp, copy the API key to us, and send "hi". Creating the agent needs their primary phone, not WhatsApp Desktop. For Anyhour, make this a guided setup step:

1. Show the three steps with screenshots.
2. Accept the pasted key in a field, store it encrypted, and never show it again.
3. Show "Waiting for your hi…" until the first inbound message links the owner, then confirm in both the dashboard and WhatsApp.

Product work still open: per-organization agent tokens, one poller per agent (respecting the single-poll rule and rate limits), key rotation when an owner regenerates or reinstalls, and a fallback channel (email) when the token stops working.

## Status in Anyhour (October 2026)

- Built: per-workspace agent key stored AES-GCM encrypted (`whatsapp_agent`, migration 0041), guided setup on the Tools page, "Waiting for your hi…" until the first inbound message links the owner, `whatsapp-poll` job per workspace (stately queue, one poll at a time per agent, ~50 s long-poll rounds, re-queued by the worker's maintenance loop), `notifyOwner` and due reminders on WhatsApp with email fallback, "Ready to send" draft alerts, exact commands (send, skip, take over, on, off, status), 15-minute stale cutoff, autopilot (2 minutes, only drafts alerted while it was on, one attempt each), 401 marks the agent broken and alerts go back to email. Code: `packages/api/src/services/whatsapp/`.
- Built since (docs/teamChat.md): agents are per person (any member links their own, up to 5, each to one employee; `whatsapp_agent.assistantId`, one poll job per agent), free text goes to the owner assistant with that member's permissions after the exact commands, quoted alerts carry their item, risky actions need an exact "yes", and the conversation is the member's shared thread with the employee, shown in the dashboard. Alerts go to the agent for the employee they're about, otherwise the person's first.
- Since 2026-10-31 (docs/yourAi.md): one agent per person, talking as the workspace's one AI; alerts and "Ready to send" drafts come from it, and "Send me a test" (`POST .../whatsapp/:agentId/test`) checks it.
- Since 2026-10-31 (Workflows and reminders removed): alerts are a new lead (sent from the `lead-captured` job, `services/leads/captured.ts`) and a handoff (`services/support/handoff.ts`), both through `teamChat/notify.ts` with email for anyone no app reached. With no drafted email replies left to approve, the command words (send, skip, take over, on, off, status), "Ready to send" alerts and autopilot are gone: every message goes to the owner assistant, which replies to handed-off visitors with `reply_to_conversation`.
- Open: media messages and voice notes, key rotation without saying hi again, message retention.

# Your AI in your team's chat apps

The workspace's AI ([yourAi.md](yourAi.md)) is messaged from the owner's and their team's WhatsApp and Slack, and sends alerts there. It's the same owner assistant as the dashboard chat, with the same tools, skills and the linked person's permissions. Spec: [channels.md](channels.md), "Wave 3 first" and "Wave 3a". WhatsApp details: [whatsappOwnerAlerts.md](whatsappOwnerAlerts.md).

## How it fits together (API)

| Part | Where |
|---|---|
| Adapter interface, formatting and splitting per app, the turn, the shared thread, linking, alert fan-out | `services/teamChat/` |
| Connector framework: provider registry, OAuth install, signed webhooks, stored events, credentials, broken status | `services/connections/`, tables `connection`, `connection_event`, `connection_member` |
| Settings | `config/teamChat.config.ts` |

- **One thread per person.** Their `workspace_chat` with the AI (`shared = true`, `services/teamChat/thread.ts`), which is also their dashboard chat, so the dashboard shows what was said in each app (`workspace_message.via`) and every app sees the dashboard's history. Alerts a person got join that thread too, so a reply to one has context.
- **Acting as the member.** A turn runs the owner assistant with a short server-side Better Auth session for the linked member, deleted after the turn. Every tool call goes through the API's normal permission checks: a member can't do what the dashboard wouldn't let them.
- **Risky actions are held.** From a chat app, tools in `confirmFirstTools` (sending a customer reply, deleting, inviting, changing roles) store the action and show a confirmation instead. Only a button tap (Slack, the dashboard) or an exact "yes" (WhatsApp) runs it, from the stored input, before the next model call.
- **Inbound:** `POST /api/connect/:provider/webhook` checks the signature, stores the event once (`connection_event`), acks at once and queues a `team-chat` job (one at a time per person). WhatsApp keeps its poller; each message becomes a `team-chat` job.
- **Unlinked people** in Slack get a one-time "Link your account" link (only they see it) and nothing else. Opening it signed in links them (`/link/:token` in the dashboard).
- **Alerts** (`services/teamChat/notify.ts`) go to every app a recipient linked, sent by the AI; they join the person's thread. A Slack alerts channel gets them once instead of each person's DM. Whoever no app reached is emailed, as before.
- **Broken:** a 401/403 from Slack (or WhatsApp rejecting a key) marks it broken, emails the owners once and alerts fall back to email.
- **Env:** Slack is offered only when all its variables are set. Otherwise its card on Channels says "Not available yet".

## Slack: set up our app once

1. Go to <https://api.slack.com/apps> → **Create New App** → **From scratch**. Name it "Anyhour" and pick a development workspace.
2. **Basic Information → App Credentials:** copy the Client ID, Client Secret and Signing Secret into `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET`.
3. **OAuth & Permissions:**
   - Redirect URL: `<BETTER_AUTH_URL>/api/connect/slack/callback` (for example `https://api.anyhour.app/api/connect/slack/callback`).
   - Bot Token Scopes: `app_mentions:read`, `channels:read`, `chat:write`, `groups:read`, `im:history`, `im:read`, `im:write`.
4. **App Home:** turn on the **Messages Tab** and tick "Allow users to send Slash commands and messages from the messages tab".
5. **Event Subscriptions:** turn on, Request URL `<BETTER_AUTH_URL>/api/connect/slack/webhook` (Slack checks it at once, so the API must be running with the signing secret). Subscribe to bot events `app_mention`, `message.im`, `app_uninstalled` and `tokens_revoked`.
6. **Interactivity & Shortcuts:** turn on, Request URL `<BETTER_AUTH_URL>/api/connect/slack/webhook` (the same URL; buttons arrive there).
7. **Manage Distribution:** to let other Slack workspaces install it, complete the checklist and **Activate Public Distribution**.

Then on Channels, an owner or admin taps **Add to Slack**; the AI answers there. To get alerts in a channel, invite the app to it (`/invite @Anyhour`) and choose the channel on the card.

## WhatsApp

Nothing to set up on our side. Each person creates their own agent in WhatsApp (Settings → Agents → Create an agent), pastes its API key on Channels and sends it "hi". The AI answers there (one agent per person); "Send me a test" checks it.

## Not built yet

Telegram, Microsoft Teams and Google Chat (same adapter interface), voice notes and media. Customer WhatsApp (wave 3b) is built: see [customerWhatsapp.md](customerWhatsapp.md).

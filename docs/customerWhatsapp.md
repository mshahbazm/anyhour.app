# Customers on your WhatsApp number

Customers message the business's own WhatsApp number and its AI team member answers, in the same inbox as the website chat. Spec: [channels.md](channels.md), "Wave 3b". This is not the owner's WhatsApp ([teamChat.md](teamChat.md), [whatsappOwnerAlerts.md](whatsappOwnerAlerts.md)): that is a personal agent that only talks to its creator.

## How it fits together (API)

| Part | Where |
|---|---|
| Provider: Meta's webhook check, signature, reading the webhook | `services/connections/whatsappBusiness.ts` (`whatsapp_business` in the registry) |
| Graph API calls, error mapping, sends per number | `services/connections/whatsappBusinessApi.ts` |
| Connecting by pasting (ids, token, AI team member) | `services/customerWhatsapp/connect.ts`, `POST /api/organizations/:id/connections/whatsapp_business` |
| A message in: contact, conversation, message, then the answer | `services/customerWhatsapp/inbound.ts` |
| One answer at a time, with the website's answer pipeline | `services/customerWhatsapp/reply.ts` |
| Sending: the 24-hour window, the template, delivery status | `services/customerWhatsapp/send.ts` |
| Settings | `config/customerWhatsapp.config.ts` |

- **Any AI team member** can be linked to a number, on connect and when changing who answers.
- **Inbound:** `POST /api/connect/whatsapp_business/webhook` checks `X-Hub-Signature-256` with `WHATSAPP_APP_SECRET`, stores each message and status once (`connection_event`), acks at once and queues it (`team-chat` job, one at a time per customer). `GET` on the same URL answers Meta's check with `WHATSAPP_VERIFY_TOKEN`.
- **Conversation:** one per number and customer (`conversation.connectionId` + `externalUserId`, the wa_id), `channel: 'whatsapp'`. The contact is found by a `whatsapp` or `phone` identity, or created with their WhatsApp profile name and a `whatsapp` identity. Meta verifies the sender's number, so it's the first verified identity; contact facts still stay owner-only.
- **Answer:** the website's pipeline (`services/chat/answer.ts`) with `playbooks/whatsapp.md` added: short, plain text, at most one link, never ask for a phone. Its WhatsApp number counts as given for `capture_lead`. A lock per conversation and a reply key per message (`<wamid>:reply`) mean two quick messages get one answer, and a message that arrives mid-answer gets the next one.
- **Media:** photos, documents, voice notes and the rest are stored as `[image]`, `[document]`, `[voice note]`… (with any caption) and the AI team member asks for text.
- **The 24-hour window:** free text only within 24 hours of the customer's last message. After it, the template set on My tools is sent with the reply as its one variable. Without a template, an AI team member reply is kept as the draft in Needs you, and a staff reply is refused (`409 whatsapp_window_closed`) with the text kept as the draft.
- **Handoff and staff replies:** as on the website. A staff reply goes out through the Graph API; the AI team member then stays quiet until released.
- **Delivery status:** status webhooks set `message.deliveryStatus` (sent, delivered, read, failed); the inbox shows it under each reply.
- **Limits and errors:** at most `sendsPerSecond` sends per number per process (a burst waits up to `maxSendWaitMs`); Meta's rate-limit codes are reported as rate limited. A rejected token (401 or code 190) marks the connection broken and emails the owners. Logs carry the failure kind only, never the token or the customer's text.
- **Env:** `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`. Without both, the card on My tools says "Not available yet".

## Set up our Meta app once

Anyhour uses one Meta app; each business connects its number to it.

1. Go to <https://developers.facebook.com/apps> → **Create app** → use case **Other** → type **Business**. Add the **WhatsApp** product.
2. **App settings → Basic:** copy the **App secret** into `WHATSAPP_APP_SECRET`.
3. Choose a long random string for `WHATSAPP_VERIFY_TOKEN` and restart the API with both set.
4. **WhatsApp → Configuration → Webhook → Edit:** Callback URL `<BETTER_AUTH_URL>/api/connect/whatsapp_business/webhook` (for example `https://api.anyhour.app/api/connect/whatsapp_business/webhook`), Verify token the same string. Meta checks it at once, so the API must be running.
5. Under **Webhook fields**, subscribe to **messages** (this carries both messages and delivery statuses).
6. To serve other businesses, complete **App review** for `whatsapp_business_messaging` and `whatsapp_business_management` and publish the app (Live mode). Until then only numbers in our own business portfolio work.

## Connect a business's number (on My tools)

The business needs a WhatsApp Business Account with its number registered on the Cloud API, and a token that works with our app.

1. **WhatsApp Manager → Phone numbers:** open the number and copy its **Phone number ID** and the **WhatsApp Business Account ID**.
2. **Business settings → Users → System users:** add a system user (admin), assign it the WhatsApp account (full control) and our app, then **Generate new token** for our app with `whatsapp_business_messaging` and `whatsapp_business_management`, expiry **Never**.
3. On My tools, an owner or admin pastes the two ids and the token, chooses the AI team member and taps **Connect**. We check them with Meta and subscribe our app to the account's webhooks (`POST /<account id>/subscribed_apps`).
4. Optional, for replies after 24 hours: in **WhatsApp Manager → Message templates**, create a **Utility** template whose body has one variable, for example "Here's our reply to your message: {{1}}". Once Meta approves it, type its name on the card.

Embedded Signup can replace steps 1 to 3 later.

## Not built yet

Embedded Signup, sending media, voice-note transcription, interactive buttons and lists (wave 4 chat blocks), and relaxing owner-only contact facts for verified identities.

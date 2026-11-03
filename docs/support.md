# Support: inbox and handoff

Wave 2 of the plan in [contacts.md](contacts.md), agreed with the user on 2026-10-29 and reshaped in round 2 ([focusedProduct.md](focusedProduct.md), "Handoff replaces tickets"). Read [yourAi.md](yourAi.md) first. Its rules still hold:
- Never make things up.
- "Problems" are passed to a person.
- The UI says the AI's name or "your AI", never "bot".

For businesses without a helpdesk, Anyhour is where they handle customers. Those with Zendesk or Freshdesk get a connector later (wave 5).

## Principles
- **Chat-first and light.** It's a shared inbox where the AI does most of the work. By default the owner only looks at **Needs you**.
- **Conversations only.** There are no tickets: a conversation that needs a person waits in Needs you until someone replies or hands it back to the AI.
- **Not a helpdesk clone.** No SLA policy engine, macros library, multi-brand help centre or complex routing.

## Model

| Entity | What | Scope |
|---|---|---|
| `conversation` | Messages on one channel: `handledBy` (`agent \| human`), `assignedMemberId`, `needsHumanSince` (null when not waiting), `handoffSummary`, `handoffDraft`, and `channel` (`widget`, `whatsapp`) | Workspace via its AI |
| `conversation.handedOffAt` | When the AI last handed it to a person (the handoff that alerted); kept after it's resolved, for the month's numbers | |
| `message` | Staff replies are `role: 'staff'` with `staffMemberId`; `noteOffer` (`{ title, text }`) while the AI offers to remember that reply | |

## Handoff
1. The AI's `hand_off` tool is for when the visitor asks for a person, has a problem or complaint, it is not sure, or money is involved such as refunds.
   - It tells the visitor plainly that a person will reply, and asks for an email or phone if none is known (reusing lead capture).
   - It sets `needsHumanSince` and writes a short `handoffSummary` (why, what they want, what's known, a suggested next step).
2. **Owner alert.** Email to every owner always, plus their WhatsApp or Slack when linked (`teamChat/notify.ts`). A conversation that already alerted isn't alerted again until it is resolved.
3. **Takeover.** In the inbox a member can:
   - reply as staff: the message reaches the widget (or WhatsApp), shown with the member's first name
   - hand it back to the AI: `handledBy` returns to `agent`.

   Either one clears `needsHumanSince`, so the conversation leaves Needs you. While `handledBy = human`, the AI does not reply; the visitor gets "The team will reply here" and their message puts the conversation back in Needs you.
4. **Drafted reply.** On handoff the AI drafts a suggested reply in the background (grounded, owner-facing, may use contact facts). It's shown in the composer for the member to send or edit (`support/draftReply.ts`).
5. **Live delivery.** The open widget polls `GET /api/widget/:id/conversations/:id/updates` for staff messages.

## Your replies teach the AI
When a person replies to a conversation that needed them (`needsHumanSince` set or `handledBy = human`), `support/noteOffer.ts` makes one Luna call (task `noteOffer`, recorded in `ai_usage_event`): is the answer general business knowledge (prices, hours, policies, how things work), and if so a note title and the fact in plain words without the customer's details. Replies only about that customer get no offer; when unsure it offers. A failed call just means no offer.

- **Dashboard reply** (`POST .../conversations/:id/messages`, `noteOfferIn: 'inbox'`, the default): the offer is stored on the reply (`message.noteOffer`, one open per conversation) and shown under it as a card for owners and admins: "Save this so I can answer it next time?" with the editable topic and fact, Save and Not now. Save runs the normal note save: `POST .../assistants/:id/notes/conflicts`, then `POST .../business/notes` with `fromMessageId`; when a page disagrees the card shows it ("Use my new answer" saves with the overrides, "Keep the website's answer" drops the offer). Not now is `DELETE .../conversations/:id/messages/:messageId/note-offer`.
- **Reply through the AI's chat** (dashboard, WhatsApp or Slack; `reply_to_conversation` sends `noteOfferIn: 'chat'`, so nothing is stored): the tool holds `add_knowledge_note` (with `fromMessageId`) behind a confirmation, "Save this so I can answer it next time?" with Save / Not now buttons. A tap or an exact "yes" saves it through the usual note save and website-conflict card; anything else drops it.
- **Answers learned:** a note saved with `fromMessageId` is a `knowledge_source` with `kind: 'note'` and `discoveredVia: 'reply'`, and the reply's offer is cleared. The month's numbers count these.

## Inbox (web)
- **Filters:** Needs you (`needsHumanSince` set), AI handling, Closed, All. The sidebar badge is the Needs you count (`GET .../attention`).
- **List rows:** contact name or "Visitor", channel icon, last message and waiting time.
- **Conversation view:** messages (staff messages with names, and the offer to remember a reply under it), the handoff summary card, a composer prefilled with the draft with Send and "Hand back to the AI", and a contact side panel (identities, memory, leads) linking to the contact page.
- **Mobile:** the inbox and conversation view work at phone width. Owners reply from their phone.

## Owner chat tools
`list_needs_you`, `read_conversation`, `reply_to_conversation` (as staff, through the API with the user's session) and `release_conversation`, in the `support-inbox` skill. Replies the owner dictates in chat go out as staff messages under the owner's name.

## Permissions
`conversation: read, reply` for every role; API keys can't.


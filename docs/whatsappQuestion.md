# WhatsApp question

A starter question with a WhatsApp icon that the owner adds under "What visitors see first". Tapping it asks the AI to move to WhatsApp; a **rule** decides how the AI does that, and the AI shares the number as a **WhatsApp button** (a chat block), never as typed text. We record when a visitor asks and when they open WhatsApp.

## Owner flow (web, `features/tryBot/firstImpression.tsx`)

- Next to "+ Add a question" there's "+ WhatsApp" (shown while none is set). It doesn't count toward the 4 questions; at most one.
- Clicking it calls the number lookup, then opens an inline panel in the same chat-preview style:
  - **Question** text, default `Chat with us on WhatsApp`, max 80 chars.
  - **Number**: prefilled when found, with one muted line saying where from ("From your WhatsApp channel" / "Found on your website"); empty otherwise, with the label "What's your WhatsApp number or link?". Accepts `+44 7700 900123`, `447700900123`, `wa.me/447700900123`, `https://api.whatsapp.com/send?phone=…`.
  - **When someone taps it**: three radio options, default `quickQuestion`:
    - `straightAway` — "Share it straight away"
    - `quickQuestion` — "Ask their name and what they need first"
    - `qualifyFirst` — "Qualify them first"
  - Save / Cancel.
- Saved, it shows in the questions list as a chip with the WhatsApp icon. Clicking the chip reopens the panel; × removes it (and its rule). If the rule was changed elsewhere (in chat), the panel shows a fourth, selected option "Your own rule" and saving without picking another keeps it.

## Data

`assistant.appearance.whatsapp` (jsonb, inside the existing appearance object; no migration):

```ts
interface iWhatsappQuestion {
  question: string           // 1..80
  number: string             // digits only, with country code, 8..15 digits
  approach: tWhatsappApproach // 'straightAway' | 'quickQuestion' | 'qualifyFirst'
  ruleId: string | null      // the member_rule this created
}
```

- The generic `PATCH .../assistants/:id` appearance save must never drop or set `whatsapp`: strip it from the PATCH schema and keep the stored value when merging.
- **Public widget config** (`/api/widget/:id/launcher` and chat bootstrap) carries only `appearance.whatsapp = { question }` — never the number, so owners who qualify first don't leak it.
- Owner `GET .../assistants/:id` returns `appearance.whatsapp` with `approach: tWhatsappApproach | 'custom'` — `custom` when the rule row is gone or its text no longer equals the preset text.

`conversation` gets two nullable timestamps (Drizzle migration via `drizzle-kit generate`): `whatsappAskedAt`, `whatsappOpenedAt`.

## Owner API (`assistant` update permission; read for GET)

- `GET /api/organizations/:org/assistants/:id/whatsapp-question/number` → `{ number: string | null, source: 'channel' | 'knowledge' | null }`
  1. An active `whatsapp_business` connection: its number as customers see it.
  2. Else Your business: a fast regex pass over notes and the top retrieval passages for `wa.me/…`, `api.whatsapp.com/send?phone=…`; else one cheap model call (new task in `config/models.config.ts`, Luna, low effort, `generateObject`) over those passages (query like "WhatsApp number contact phone"), returning a number only when the text clearly says it's WhatsApp. Passages are quoted as data.
- `PUT /api/organizations/:org/assistants/:id/whatsapp-question` body `{ question, number, approach }` (approach may be `'custom'` only when a rule already exists — then the rule is left alone). Normalises the number (400 with a clear message if it isn't 8–15 digits), creates or updates the rule, saves `appearance.whatsapp`, clears the widget site cache. Returns the owner shape.
- `DELETE` same path: removes `appearance.whatsapp` and deletes its rule (if it still exists).

### The rule (`member_rule`, through `services/memberRules/`)

Preset texts live in one config (`config/whatsappQuestion.config.ts`):

| approach | kind / tag | text |
|---|---|---|
| straightAway | rule / `always` | When someone asks to talk on WhatsApp, send the WhatsApp button straight away. |
| quickQuestion | rule / `askFirst` | When someone asks to talk on WhatsApp, first ask their name and what they need in one short message, then send the WhatsApp button. |
| qualifyFirst | rule / `askFirst` | When someone asks to talk on WhatsApp, ask your lead questions first, and send the WhatsApp button only once they're a good fit. |

New rule is appended (last position). Changing approach updates that row's text and tag. Use the existing rules service functions; don't write SQL around them.

## Visitor side

### Block `whatsapp` (`schemas/chatBlock.schema.ts`, `services/chat/blocks.ts`)
- Model input: `{ kind: 'whatsapp' }` — nothing else; the server fills the rest.
- Stored: `{ kind: 'whatsapp', id, label: 'Chat on WhatsApp', url, fallback }` where `url = https://wa.me/<digits>?text=<encoded "Hi, I found you on your website.">` and fallback `Chat with us on WhatsApp: <url>`.
- Resolving fails (`ok: false`, reason the model sees) when the AI has no `appearance.whatsapp`, or the conversation's channel is WhatsApp ("They're already on WhatsApp").
- WhatsApp-channel rendering (`customerWhatsapp/blocks.ts`) just uses the fallback (it will never get one, but keep the switch exhaustive).

### Prompt (`services/chat/visitorPrompt.ts` + a small `playbooks/whatsappQuestion.md`)
Only for website conversations when `appearance.whatsapp` is set:
> The business also talks with customers on WhatsApp. When someone asks to talk on WhatsApp, or taps "<question>", follow the owner's rules about it. To share it, call send_blocks with kind "whatsapp". Never type the number or a wa.me link yourself.

The question is quoted as data.

### Tracking
- **Asked**: when a website visitor message's text equals `appearance.whatsapp.question` (trimmed, case-insensitive), set `conversation.whatsappAskedAt` if null. Also count it in insights as metric `whatsappAsks` when `tracking.chat` is counted (same path as `prompts`).
- **Opened**: widget `POST /api/widget/:botId/conversations/:conversationId/whatsapp-open` `{ blockId }`, authenticated exactly like the other conversation-scoped widget calls (resume token). Checks the block exists on a message of that conversation and is `kind: 'whatsapp'`; sets `whatsappOpenedAt` if null; 204. Rate-limited like the other public routes. Insights metric `whatsappOpens` when chat is counted.
- Owner conversation API exposes both timestamps; the conversation view (`packages/web/src/features/conversations`) shows a small muted line/badge "Asked for WhatsApp" / "Opened WhatsApp".

## Widget (`packages/widget`)
- `iAppearance.whatsapp?: { question: string } | null`.
- Starter chips: after the normal prompts, the WhatsApp question as a chip with a small WhatsApp glyph (add to `iconPaths.ts`), in the teaser (`launcher.tsx` **and** the plain-DOM `embed/launcherView.ts`, mirrored class for class) and in the empty chat (`botChat.tsx`). Tapping sends its text like any starter.
- Block `whatsapp` in `blocks.tsx`: a full-width link-button, WhatsApp green (`#25D366`, dark text-on readable), glyph + label, `target="_blank" rel="noopener"`. On click, fire the open call (keepalive / beacon, never blocks the navigation). Through a callback prop like the other block actions, so the dashboard preview can pass a no-op or real call.
- `embed/loader.ts` must stay React-free and small.

## Glossary
Add "WhatsApp question" (the starter question) and "WhatsApp button" (the block the AI sends) to `docs/glossary.md`.


---

# Revision 2 (2026-11-05): the number is a fact

Agreed with the owner after the first build: the WhatsApp number is a **fact in Your business**, not a setting. The WhatsApp question only holds its own settings. This revision replaces anything above that stores or reads `appearance.whatsapp.number`.

## Contact details (new, like opening hours)

Facts stay where they are (notes and website text). Contact details are **read, never typed**, exactly like opening hours (`services/workspace/hoursFromKnowledge.ts`, the `business-hours` job):

- `organization.contactDetails` (jsonb, nullable; Drizzle migration):
  ```ts
  interface iContactDetails {
    whatsapp: iContactDetail | null
    phone: iContactDetail | null
    email: iContactDetail | null
    address: iContactDetail | null
  }
  interface iContactDetail {
    value: string            // whatsapp/phone: digits with country code; email lowercased; address one line
    source: 'note' | 'website'
    sourceId: string | null  // the knowledge_source it came from
  }
  ```
- A `contact-details` job, queued by `knowledgeChanged` next to `business-hours`, same settle/stately behaviour. `services/workspace/contactsFromKnowledge.ts`: the AI's own search for contact details plus every note, **notes win**; one Luna/low `generateObject` task `contactDetails` (replaces the `whatsappNumber` task; delete that one). Regex pre-pass for `wa.me` / `api.whatsapp.com` links is fine. A WhatsApp value is only accepted when the text says it's WhatsApp (a plain phone is `phone`, not `whatsapp`) and the digits appear in the text. Found details overwrite; nothing found for a field clears it only if its `sourceId` no longer exists or no longer contains it (so a deleted note removes the number).
- `GET .../business` returns `contactDetails`. Your business shows a small read-only "Contact details" block next to opening hours, same style, only the fields found.
- The visitor prompt's business context gets the found details (quoted as data) so the AI shares the right phone/email; WhatsApp is still only shared through the WhatsApp button when the question is on.

## WhatsApp question, revised

- `appearance.whatsapp` = `{ question, approach, ruleId }` — **no `number`**. Drop `number` on read of old rows.
- Owner GET adds read-only `number: string | null` and `numberSource: 'channel' | 'note' | 'website' | null` to `appearance.whatsapp` (from the connected WhatsApp Business number first, then `contactDetails.whatsapp`).
- `GET .../whatsapp-question/number` returns the same pair from that source (no model call anymore; it reads contact details).
- `PUT .../whatsapp-question` body `{ question, approach, number? }`:
  - `number` given (and different from the known one): normalise it, then **save it as a fact** through the normal notes service: update the note titled `WhatsApp` if one exists, else add it, text `Our WhatsApp number is +<digits> (https://wa.me/<digits>).`. Skip the website conflict check (the owner typed it explicitly). Then set `contactDetails.whatsapp` right away (`source: 'note'`, that note's id) so the button works without waiting for the job.
  - No `number` and none known → 422 `whatsapp_number_missing` ("Add your WhatsApp number first.").
- The WhatsApp button reads the number at send time from the WhatsApp Business connection, else `contactDetails.whatsapp`. If none: the block fails with reason "No WhatsApp number is saved. Tell them the team will get back to them and offer to take their contact details." (the playbook says the same).
- Panel (web): unchanged look. When `number` is null on a saved question it shows one line "Add your WhatsApp number" with the field focused. The source hint reads "From your WhatsApp channel" / "From your notes" / "Found on your website".

## Owner chat (workspace agent)

- Tools (in `services/workspaceAgent/`, calling the same service, assistant update permission):
  - `get_whatsapp_question` → `{ on, question, approach, number, numberSource }`.
  - `set_whatsapp_question { question?, approach?, number? }` → turns it on or changes it; **refuses** with a clear message when no number is known and none is given.
  - `remove_whatsapp_question`.
- Skill `skills/whatsapp-question/SKILL.md` (+ loader import): check first; if no number, ask "What's your WhatsApp number or link?" and pass it as `number` (it's saved to Your business as a fact; say "Saved to your business" in one line); otherwise confirm the found number in one line. Default approach `quickQuestion`; describe the three in plain words if asked. Never create the rule by hand (the tool does).
- Owner system prompt: when the question is on but no number is known, one status line telling the AI to mention it once when relevant.

## Glossary
Add "Contact details" (WhatsApp, phone, email, address read from Your business, like opening hours).

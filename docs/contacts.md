# Contacts: one person, many deals

Agreed with the user on 2026-10-29. Anyhour is an AI-first CRM the agent fills itself, for small service businesses. It is not a HubSpot rival. This wave makes the contact the centre of the product. Companies, services and offers were built and later removed in the 2026-10-31 strip-down; business facts live in Your business knowledge. Support (handoff), customer WhatsApp, chat UI blocks, helpdesk connectors and voice come in later waves. The overall plan is at the end.

**Chat-first.** Owners talk to their agent like an employee: they train it, ask it things and tell it to do things. Screens exist where they add value, as the Knowledge page does. Contact screens are light and read-first, for seeing and quick fixes. They hand off to the owner chat where the owner would naturally ask, and they show clearly what the agent did, so the owner can trust and correct it. Where a screen needs input that is more than a name or an address, it offers one free-text field instead of a form. The owner writes in their own words, AI turns it into the record (or several), and the owner checks it before saving. Small field edits stay available.

**Two questions for every entity.**
- Chat only, or a page too? If it has a page, adding works in both places: the page and the owner chat (assistant tools).
- Workspace-wide, or one bot's? Decided for this wave:

| Entity | Page | Chat (owner assistant) | Scope |
|---|---|---|---|
| Contact | Contacts list and page; add from free text | find, details, add, update, merge suggestions shown on the page | Workspace: one person across every bot and channel |
| Contact fact (memory) | On the contact page | remember, forget | Workspace (belongs to the contact) |
| People on a deal | Lead page | add a person with a role | Follows the lead (workspace) |

## What exists today

- `contact`: one email and one phone per contact. Capture (`services/leads/capture.ts`) matches on either and refuses when they belong to different contacts.
- `lead`: already behaves as a **deal**. It has a status (new, contacted, won, lost; list in `features/leads`), qualification and activity.
- `GET /:organizationId/contacts` lives in `lead.routes.ts`. There is no contacts screen.

We keep the name `lead` in code for the deal. We don't rename tables.

## Model after this wave

```
contact (one person, forever)
 ├─ contact_identity   email · phone · whatsapp   (unique per workspace)
 ├─ contact_fact       memory: "prefers evenings"
 ├─ conversation       (already linked by contactId)
 └─ lead (deal)
      └─ lead_contact  several contacts per deal, each with a role
```

### Rules
- **A contact is one person.** Every way of reaching them is a `contact_identity` row. `contact.email` and `contact.phone` stay as the display values, and are kept equal to an identity of that kind when one exists.
- **Identities link only on a confirmed match.** The same normalized email or phone links. Names never link. One identity (kind + normalized value) belongs to at most one contact per workspace: a unique index enforces it.
- **Someone becomes a contact only when we can reach them.** A mum booking for her kids is the contact, and the kids go in the deal's notes. A husband whose number she gives becomes a second contact on the deal, with a role.
- **Many deals per contact**, including several open deals at once.
- **Memory is owner-facing only for now.** Capture links a conversation to a contact from an email or phone a visitor typed, and anyone can type someone else's email. So the visitor bot must **never** read `contact_fact` or another conversation's content. Facts appear on the contact page, the lead page, owner drafts (`aiReply` drafts go to that contact's own address) and the owner assistant. Revisit when identities can be verified, for example by a WhatsApp sender ID or an email link.

## Schema (one entity per file in `db/schema/product/`)

| Table | Columns | Notes |
|---|---|---|
| `contact_identity` | id, organizationId (cascade), contactId (cascade), kind `email \| phone \| whatsapp`, value (as given), normalizedValue, source `chat \| form \| manual \| merge \| backfill`, createdAt | unique (organizationId, kind, normalizedValue); index contactId |
| `lead_contact` | leadId (cascade), contactId (cascade), role `requester \| decision_maker \| point_of_contact \| billing \| other`, addedAt | PK (leadId, contactId); index contactId. The lead's `contactId` is the requester and always has a row |
| `contact_fact` | id, organizationId (cascade), contactId (cascade), text (≤ 500 chars), source `agent \| member`, conversationId (nullable, set null), createdByMemberId (nullable, set null), timestamps | index (contactId, createdAt) |

Migrations: `drizzle-kit generate` for the DDL, then `drizzle-kit generate --custom` for the backfill (generated file, SQL written into it):
- one `contact_identity` per existing contact email and phone (source `backfill`, `on conflict do nothing`)
- one `lead_contact` requester row per existing lead.

## API

Permissions (`config/permissions.config.ts`):
- `contact: read, update` for every role (same as `lead`). It covers contacts, identities, facts and merges.
- API keys don't reach contacts (they only serve the WordPress plugin's site sync).

Routes, each thin with its schema in `schemas/` and logic in `services/contacts/`. All are scoped to the verified organization.
- `routes/contact.routes.ts` (move the existing list here):
  - `GET /:org/contacts?q=&cursor=` searches name, email, phone and identities, and includes an open-deal count.
  - `GET /:org/contacts/:id` returns the contact plus identities, facts, deals (status, role, open or closed), conversations (id, bot, last message, status) and the latest 20 activities across its deals.
  - `PATCH /:org/contacts/:id` sets the name.
  - `POST /:org/contacts/:id/identities` takes `{kind, value}` and is normalized like capture. It returns 409 `identity_taken` with the other contact's id when another contact owns the identity, so the UI can offer to merge.
  - `DELETE /:org/contacts/:id/identities/:identityId`. The last remaining identity can't be removed (422). Keep `contact.email`/`phone` in step.
  - `POST /:org/contacts/:id/merge` takes `{sourceContactId}`. In one transaction under advisory locks on both ids, it moves identities, leads (`contactId`), `lead_contact` (keeping the stronger existing role on a clash), conversations and facts to the target, fills a blank name, then deletes the source. Every moved deal gets a `lead_activity` entry. Merging a contact into itself is a 422.
  - `GET|POST /:org/contacts/:id/facts`, plus `PATCH|DELETE /:org/contacts/:id/facts/:factId`.
- Leads:
  - Lead list and detail include `contacts [{id,name,email,phone,role}]`.
  - `POST /:org/leads/:id/contacts` takes `{contactId, role}`.
  - `PATCH /:org/leads/:id/contacts/:contactId` takes `{role}`.
  - `DELETE` the same path. The requester (`lead.contactId`) can't be removed; 422.
  - Each change writes `lead_activity` (new kinds `contact_added`, `contact_removed`).
- Capture (`services/leads/capture.ts`):
  - Match through `contact_identity` instead of the contact columns, keeping the advisory locks and the 409 when email and phone point to different contacts.
  - Add identities for new details (source `chat`/`form`) and the `lead_contact` requester row.
- Response types go in `types/contact.types.ts` for the web client.

## Contact memory (second agent, after the API lands)

- When a conversation ends (`conversation.ended` already fires from the idle sweep), and the conversation has a contact and isn't a test, a queued job extracts at most 5 short, durable facts.
  - Kept: preferences, circumstances, constraints, people involved.
  - Never kept: secrets, card details, health details beyond what the business needs, or anything already in the deal fields.
  - It uses `generateObject` with a new `contactFacts` task on the cheapest tier in `config/models.config.ts`, with usage recorded. The existing facts are given so it can skip duplicates.
  - Writes are `contact_fact` rows with source `agent` and the conversationId.
- `aiReply` drafts and the lead email summaries may read the contact's facts. The visitor bot may not.
- Owner assistant tools, each with a skill per `packages/api/AGENTS.md`:
  - `find_contacts` (search)
  - `contact_details`
  - `remember_contact_fact`
  - `forget_contact_fact`

## Web (`packages/web`)

- **Sidebar:** add **Contacts** next to Leads/Conversations.
- **Routes:** `_workspace.contacts.index.tsx` and `_workspace.contacts.$contactId.tsx`; feature code in `features/contacts/`.
- **Contacts page:** a searchable list of people with name, ways to reach them (icons), open deals and last activity. Empty states invite, they don't apologise.
- **Contact page:**
  - Header with the name.
  - Ways to reach them: identities, with add and remove. A 409 offers "Merge with <name>".
  - Memory: facts with add, edit and delete, marking which came from the agent.
  - Deals: each with status and role, linking to the lead.
  - Conversations, and a short timeline.
  - "Merge another contact into this one" (search, then confirm).
- **Lead page:** a People block (contacts with roles: add existing contact via search, change role, remove; the requester is fixed).
- Minimal shadcn/Base UI design consistent with the current pages. Sentence case. No placeholders shown as real data.

## Later waves (agreed, not in this wave)
1. **Support:**
   - Inbox across channels, where the bot answers first and hands off with a summary and a draft.
   - Owner alerts when the AI hands a conversation to a person.
   - Knowledge gaps already exist.
2. **Customer WhatsApp channel**, and WordPress and Shopify plugins on one connector framework (connection, inbound webhooks, outbound actions, sync jobs).
3. **Chat UI blocks** (buttons, slots, checklists, to-dos, cards), rendered per channel with a text fallback.
4. **Helpdesk connectors** (Zendesk or Freshdesk first). Their desk owns the ticket.
5. **Later still:** HubSpot/Pipedrive sync, analytics, and reconsidering cells (spike on branch `spike/celld-knowledge`).

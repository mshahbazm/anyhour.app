# Focused product: round 2

## The one job

**Anyhour is an open-source AI that answers your website and WhatsApp, turns visitors into leads, and pings you on WhatsApp when someone wants to buy.**

Catching leads is the main goal; answering everyday questions (support) is what it does on the way, and handing over to the owner when it can't is the safety net. It's for businesses where one enquiry is worth real money: trades, clinics, salons, agencies, caterers, tutors, local services. Not e-commerce support or SaaS help desks. Open source means the business owns its leads and customer chats, can bring its own AI keys and self-host, and agencies can install it for clients. Agreed in chat on 2026-11-03. Every screen and prompt should read as part of this job; a feature that doesn't help catch or close a lead waits for a real user to ask.

### The sidebar

Results first, then the AI and what shapes it, under its name:

- Chat with (name), Leads, Inbox, Contacts: the AI's chat is the front page, then what it brings in. Leads comes before Inbox because leads are the product.
- Setup: Your business (what it knows), Rules, Channels. Profile is a tab beside the AI's chat.
- The brand at the top is the business (workspace), not the AI.

### The front page is the AI's chat

No dashboard. Opening the app opens the AI's chat, and the AI's newest message is a briefing: conversations that need you, this month's funnel, a line of totals and the newest leads, each leading to the list behind it. The owner looks at the data or keeps chatting. The AI is called Paige until the owner renames it.

Anyhour answers a business's customers on its website and WhatsApp, catches the ones who want to buy, and pulls the owner in on their own WhatsApp or Slack when it needs them. Round 1 removed social posts, voice, Discord, companies, services, offers and workflows. Round 2 reshapes what is left around that one job. Agreed in chat on 2026-10-31.

There is no production data yet. Don't write data migrations; schema changes go through `drizzle-kit generate` only, and the local database is cleaned by hand after each step. Avoid schema changes that would fail on existing rows (a new NOT NULL column without a default, a unique index over duplicates); say so in the report instead.

## 1. One AI per business

- A workspace has exactly one AI (`assistant` row), made at sign-up with the name the owner picks. It answers customers on every channel (website chat, WhatsApp Business) **and** talks to the owner and their team (dashboard chat, their own WhatsApp, Slack).
- Keep the `assistant` table and the `assistantId` columns that point at it: they are the AI's identity (the widget's `data-bot`, conversations, usage). Resolve "the workspace's AI" in one place in the API and stop accepting a choice of AI from clients where there can only be one.
- Remove: `assistant.isLead` and everything about a lead (only-talks-to-you rule, `lead_answers_only_you`, move-website, alert sender naming a member), adding/deleting AIs, team proposals and the `teamProposal` card, the employee setup flow, per-AI tools (`assistant.tools`), choosing which AI answers a channel, and every per-AI page in the web (`/team/$assistantId/...`). The sidebar shows the one AI by name, no "Your AI team" list and no "Add".
- Knowledge has one layer: **Your business**. Remove the AI's own layer (`scope: 'mine'`, `ownedBy`/`readableBy` split, per-AI What-I-know pages). The `knowledge_*.assistantId` columns may stay nullable and unused if dropping them is large; note it.
- The owner chat is one thread per person with the AI (not per person per AI). The same thread is shared with their WhatsApp/Slack as today.
- Customer-facing safety stays: the visitor bot never gets owner tools. The line is the channel (customer vs owner), not a separate AI.

## 2. Handoff replaces tickets

- Remove tickets (table, activity, routes, Tickets tab, "Create ticket", owner-chat tools, MCP tools, ticket mentions in prompts). `hand_off` only marks the conversation as needing a person (`needsHumanSince` + summary) and alerts the owners.
- The Inbox is conversations only, with the "Needs you" filter. A conversation stops needing you when a person replies or hands it back to the AI.

## 3. One Rules page

- Rules belong to the one AI. Remove the "for everyone" vs "this AI" choice (`memberRule.assistantId` nullable split). One Rules page in the web, same rule kinds (one-line rule, steps for a situation).

## 4. Simple lead statuses replace pipelines

- A lead has a fixed `status`: `new`, `contacted`, `won`, `lost`, plus an optional `value` (money, set when won) and `closedAt` (set for won/lost).
- Remove pipelines, stages, stage templates, stage locks, the Board view, the pipeline picker, `roleNouns` and `businessType`-driven pipeline choice. Leads list filters by status. Owner chat and MCP tools move leads by status.
- Everything else about a lead stays: contact, title/summary, qualification, timeline (stage-change entries become status-change entries), conversations, notes.

## 5. Remove the leftovers

- Forms (`form`, `formField`, `formSubmission`, routes, UI). The chat's `contactForm` block stays: it is how the AI collects details in the chat.
- Website insights are **kept, opt-in** (restored after round 2 removed them). One switch for the business, Visitor counts (`assistant.tracking`), off by default and turned on by the owner. While it's on, four switches under it choose what's counted (`assistant.trackingOptions`, all on by default): visits and pages (page views, unique visitors, top pages, sources), country, device and browser, and chat opens (opens and suggested-question taps). Off, the widget sends nothing and the server ignores beacons; an option that's off isn't sent by the widget, is dropped by the server, and its sections are hidden on the Insights tab. Same privacy model as before: daily aggregate counts only (`site_stat_daily`), a daily HMAC for unique visitors (`site_visitor_daily`) pruned after 2 days, no cookies, no full URLs. The Insights view is a tab of the website panel beside the AI's chat (`/chat#website-insights`), reachable from Home.
- Public API, webhooks and MCP: remove webhooks (endpoints, deliveries, events), the public API routes the WordPress plugin doesn't use, and `packages/mcp`. Keep API keys only as far as the WordPress plugin needs them (its "sync my site" call), with one key-management spot in Settings.

## 6. Shorter onboarding

Sign-up is four steps: name your AI → add your website (it starts reading) → connect your WhatsApp for alerts (skippable) → install the chat on your site (snippet or WordPress plugin). Remove business type, "what do you want help with" and team suggestions.

## 7. Your replies teach the AI

When a person answers a conversation that needed them (dashboard reply or the owner's WhatsApp/Slack reply through the AI), the AI offers to remember the answer: "Save this so I can answer it next time?" Yes saves it as a note in Your business (through the existing note save, including the website-conflict check). The offer appears in the place the person replied: a card in the dashboard conversation view, a message in WhatsApp/Slack. Don't offer for replies that are only about that one customer (a booking time, a personal detail); the model decides, and when unsure it offers.

## 8. The proof screen

(Superseded on 2026-11-03: these numbers are now the briefing in the AI's chat, not a separate page.) The first page after sign-in shows this month, for the workspace: customers answered (and how many outside business hours, or 18:00–08:00 and weekends when hours are unknown), leads caught, leads won and their total value, times it needed you, answers it learned (notes saved from replies). Each number links to the list behind it.

Above those numbers, a funnel for the month: website visitors → visitors who started a chat (non-test website conversations started this month) → leads caught → leads won, with the share of the step before between steps. While visitor counts are off, the visitors step shows "Turn on visitor counts" (it flips the switch) instead of a number, and the other steps still show. The AI's chat stays one click away in the sidebar.

Opening hours come from knowledge, not a form (added 2026-11-03): after reading finishes or a note changes, one cheap call reads the week's hours from the notes and the website passages about them and saves them on the workspace with its time zone (the browser's at sign-up, or the one the business's knowledge names). "Outside business hours" uses them in that time zone. Your business shows them in one line; when they're unknown it offers to tell the AI, through the tell box at the top of the page.

## Words

Update `docs/glossary.md` as each change lands: the AI is called by its name, "your AI" where a generic word is needed. "AI team member", "your AI team", "Lead" (for an AI), "Ticket", "Pipeline", "Stage" and "Workflows" leave the screens.

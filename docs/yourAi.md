# Your AI

Each workspace has exactly one AI (docs/focusedProduct.md, "One AI per business", decided 2026-10-31). It replaces the AI team, the lead and the team proposal (the earlier `aiTeam.md` and `teamLead.md`). Words follow [glossary.md](glossary.md).

## One AI per business

- One `assistant` row per workspace, made at sign-up (`services/workspace/createWorkspace.ts`), named by the owner in the first sign-up step (`defaultAiName` when they keep the suggestion). Nobody adds or deletes one: the `assistant` permission is only `read` and `update`.
- It answers customers on every channel (website chat, WhatsApp Business) and talks with the owner and their team (dashboard chat, their own WhatsApp, Slack). Customer safety is by channel: the visitor bot (`services/chat/`) never gets owner tools.
- `services/assistants/workspaceAi.ts` is the one place that says which row it is: the oldest in the workspace, so a workspace with leftover rows still has one. Routes under `/assistants/:assistantId` only accept that id (`ownedAssistant`); `GET /api/organizations/:org/assistant` returns it.
- The `assistantId` columns stay: they are the AI's identity (the widget's `data-bot`, conversations, usage, gaps, the owner thread, WhatsApp agents).

## What it does with customers

It handles everything inbound: answers questions only from what it knows for sure, points visitors to the right page, finds out what they need, takes their details, tells the owner (their WhatsApp or Slack, else email), and passes problems to a person. When it can't answer it says it will check, asks for contact details and hands the conversation over. It never guesses.

## What it knows: Your business

Knowledge has one layer, **Your business**: the website, files and notes, scoped by `organizationId` (`services/knowledge/owner.ts`). Facts go to Your business; instructions go to the AI's Rules. Its prompts carry a short catalogue of what it learns from (`catalogue.ts`), and `my_sources` lists it in the owner chat. Knowledge gaps stay with the AI (`knowledge_gap.assistantId`) and show on the Your business page.

### Which website pages are read

A website teaches the business, not its blog. Every website is read page by page from our own list (`services/knowledge/crawl.ts`): known pages first (the address, earlier pages, the sitemap), each read through the page reader (`services/pageReading/`, docs/pageReading.md; never from our own server), every loaded page's links followed through the same rules, up to `maxWebsitePages` (500). Bot-protection pages fail the page, never become content.

Before a new website's first read (`services/knowledge/scopePlan.ts`), articles, listings and other-language copies become ordinary exclude rules, from free evidence first (sitemap names, the feed, dated paths, archive folders) and one Jev call for undecided groups on larger sites. It runs once, never on refreshes, and the source page lists the rules it added. Try it without reading: `bun run scope:preview example.com` in `packages/api`.

## Channels

Each website chat is a `website` connection (one per origin per workspace) and the business's number a `whatsapp_business` connection; the AI answers all of them (`connection.assistantId` is the AI). `assistant.allowedOrigins` is written alongside the website channels until it can be dropped. The install code is `data-site="<connectionId>"` (or the older `data-bot`); the widget resolves either to the AI. The owner's own WhatsApp agent (one per person) and Slack talk to the AI in the person's one owner thread (`services/teamChat/thread.ts`), shared with the dashboard chat; alerts go out as the AI.

## Rules

`member_rule` rows: a one-line rule or steps for a situation (`services/memberRules/`, `/api/organizations/:org/rules`). They belong to the workspace, so the one AI follows every rule, in order. The owner chat drafts them from plain words into a card saved with one tap.

## Web

The first page after sign-in (`/`) is this month's numbers for the workspace (`GET /api/organizations/:org/stats/month`, `services/workspace/monthStats.ts`): customers answered (non-test conversations with an AI reply this month) and how many started outside business hours (no hours or time zone are stored yet, so 18:00–08:00 and weekends, UTC), leads caught in chat, those won this month with their total value, times it needed you (conversations handed off this month, `conversation.handedOffAt`) and answers learned (notes saved from replies, docs/support.md). Each number links to its list: the Inbox (`?filter=`), Leads (`?status=`) or Your business notes. The brand in the sidebar leads back to it.

The AI's chat is `/chat`, its Profile (name, job sentence, picture) `/profile` and its Rules `/rules`, under one header with those tabs. The sidebar shows the AI by name and picture; there is no team list and no "Add".

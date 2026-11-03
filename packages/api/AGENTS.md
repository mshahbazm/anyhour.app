# Anyhour API - AI Coding Agent Reference

> Read the root `AGENTS.md` and the `AGENTS.md` of any other package before editing it.

Backend API. Bun, Hono, PostgreSQL/Drizzle, Better Auth, Zod.

## Quick Reference
- Routes: `src/routes/*.routes.ts` for product HTTP endpoints; Better Auth owns `/api/auth/*`
- Business logic: `src/services/<feature>/`
- Request validation: `src/schemas/*.schema.ts`
- HTTP contracts: `src/types/` when a product route needs one
- Product configuration: `src/config/`, including `permissions.config.ts`
- Environment validation: `src/env.ts`
- Database: `src/db/schema/`; Drizzle Kit config is `drizzle.config.ts`
- Generated migrations: `migrations/`
- Workspace agent (owner chat): prompt, skills, tools and chat cards, with how to add each, in `src/services/workspaceAgent/README.md`
- Port: **3001** by default

## File Organization

### Where Things Go
- **Routes**: `src/routes/*.routes.ts` - Hono handlers and middleware composition
- **Services**: `src/services/<feature>/*.ts` - Business logic; split by operation when useful
- **Types**: `src/types/*` - Shared API response contracts, with an index export
- **Schemas**: `src/schemas/*.schema.ts` - Zod request validation and inferred types
- **Authorization**: `src/services/auth/*` - Session, organization membership, permission, and ownership checks
- **Database**: `src/db/schema/<feature>/*` - One entity per file, folder and top-level `index.ts` exports
- **Configs**: `src/config/*` - Stable product settings, roles, and permissions
- **Environment**: `src/env.ts` - Required variables parsed once at startup

Add a folder only when the feature needs it. Do not create placeholder layers.

## Type System

### Rules
- Use `tName` for type aliases and `iName` for interfaces. Use camelCase in application code.
- Infer request types from Zod schemas and database result types from Drizzle where practical.
- Define public HTTP response types in `src/types/`; avoid importing database table types into frontend code.
- Do not create `packages/types` until two packages use the same stable product contract.

### New Route Workflow
1. Put a Zod schema in `src/schemas/<feature>.schema.ts` for untrusted input.
2. Put business logic in `src/services/<feature>/` when it exceeds a small route handler.
3. Define a response type in `src/types/<feature>.types.ts` if another client consumes it.
4. Keep the route thin: validate, authorize, call the service, return its result.
5. Check consumers in `packages/web` when changing an existing contract.

## API Development

### Route Registration
```typescript
// In app.ts
app.route('/api/organizations', assistantRoutes)
```

### Route Pattern
```typescript
assistantRoutes.get('/:organizationId/assistants/:assistantId', async (c) => {
  const { organizationId, assistantId } = c.req.param()
  await requirePermission(c.req.raw.headers, organizationId, 'assistant', 'read')
  return c.json(await ownedAssistant(organizationId, assistantId))
})
```

- Better Auth owns its response format. Product route errors use `ApiError` and the JSON error contract in `src/app.ts`.
- Let Hono infer handler return types. Avoid `any` and catch-all service wrappers that hide unexpected errors.
- Validate at the HTTP boundary. Use transactions when related writes must succeed or fail together.

## Authentication & Permissions

### Auth Flow
1. Better Auth handles Google sign-in, magic links, sessions, organizations, and invitations under `/api/auth/*`.
2. Protected product routes verify the session from `c.req.raw.headers` using `auth.api.getSession`.
3. Organization routes verify membership in the organization named by that request.
4. Routes with different role access check an action against `src/config/permissions.config.ts`.

### Permission Pattern
```typescript
await requireSession(c.req.raw.headers) // signed-in user only
await requirePermission(c.req.raw.headers, organizationId, 'assistant', 'update') // verifies membership and role
```

- One Better Auth organization is one customer workspace. Scope every product query to the verified organization.
- Use fixed `owner`, `admin`, and `member` roles. Extend Better Auth's default organization permissions rather than replacing them.
- Do not accept a client supplied role as authority. Check permissions for the requested organization, not a different active organization.
- Add new resource permissions when product routes need them; keep the mapping in one config file.

### Local Test Accounts

Use `bun run db:seed:local` to create or refresh these accounts in **local PostgreSQL only** for manual work. `bun run test:integration` starts a real API server, refreshes the local accounts, checks their behavior through HTTP, and stops the server. Both commands require the API `.env` and refuse a production environment or non-local database.

| Account | Workspace role | Expected access |
| --- | --- | --- |
| `dev-test@anyhour.local` | owner | Update/delete workspace, manage members and invitations, update the AI, read/update leads |
| `dev-admin@anyhour.local` | admin | Update workspace, manage members and invitations, update the AI, read/update leads; cannot delete workspace or change its owner |
| `dev-member@anyhour.local` | member | Read the AI and read/update leads; cannot update the AI, change workspace settings, or invite members |
| `dev-outsider@anyhour.local` | none | No access to the test workspace |

- The local seed is idempotent. It uses Better Auth's test-only helpers to create valid sessions. `bun run test:integration` creates separate integration users and a separate workspace, so it does not revoke manual sessions. The integration test verifies the role matrix, organization visibility, a rejected member invitation, an admin's rejected attempt to change the owner, and a successful role change that it restores.
- Manual session cookies are saved in `packages/api/.local-test/credentials.json`; integration cookies use `integration-credentials.json` in the same ignored directory. These are test credentials, not passwords; never print or commit them. Rerun the local seed to refresh expired manual sessions.
- Use these roles when testing a new protected route. The AI, knowledge, chat history, contacts, and leads now have product routes; verify the actual HTTP behavior alongside the permission matrix.
- `db:seed` is reserved for shared product reference data when we actually need it. Never put local accounts or sessions in a production seed.

## Database

### Rules
- Keep each entity in its own schema file. Group related files behind an `index.ts` and export groups from `src/db/schema/index.ts`.
- Use Drizzle Kit `generate` for new migrations; review the generated SQL before `migrate`. Never hand-write a migration or edit one already applied.
- Apply migrations explicitly. Do not run migrations at API startup or use `push` for deployment.
- Agree on product entities before adding their tables. An approved feature includes its necessary schema changes.
- Keep the Drizzle Kit connection in `drizzle.config.ts`; application database access stays in `src/db/`.

## Environment
- Bun loads the package `.env`; `src/env.ts` parses required variables and fails at startup with variable names, never secret values.
- Document variables in `.env.example`. Never open, print, search, diff, log, or commit an actual `.env` file.
- Keep product configuration in `src/config/`, separate from environment validation.

## Checks
- Run `bun run typecheck`, `bun run lint`, and `bun run build` in this package.
- Test routes and permission behavior when they have meaningful failure risks. Tests that claim API behavior must call the running API over HTTP and exercise the actual routes, auth, middleware, and database. Direct service tests may supplement these checks but cannot replace them.
- Write focused tests for important behavior and failure cases; do not chase a coverage percentage or add tests that only mirror implementation. Verify DB migrations against the local database before reporting them ready.
- Prefer the smallest implementation that meets the approved feature; avoid speculative integrations and duplicate patterns.

## The two bots

| | Owner assistant (`services/workspaceAgent/`) | Visitor bot (`services/chat/`) |
|---|---|---|
| Talks to | The signed-in owner/team | Anonymous website visitors |
| Behaviour | `skills/<name>/SKILL.md` — task procedures the **model** loads with `read_skill` from a catalog in the prompt | `playbooks/*.md` — fixed sections the **server** assembles from the bot's settings (goal, preview); visitors can never choose or load instructions |
| Tools | API-backed management tools forwarding the user's session; every route re-checks permissions | `search_knowledge`, `cite_sources`, `send_blocks`, `note_unanswered`, `capture_lead`, `hand_off` only |
| Prompt | `systemPrompt.ts`: persona, saved facts, style, rules, skill catalog | `visitorPrompt.ts`: base, business context, grounding, help-decide, goal, lead capture or private test, owner guidance |

- **Adding an owner capability:** add the tool, then a `skills/<name>/SKILL.md` whose frontmatter lists its `tools`, and one import in `skills/loader.ts`. `test/unit/workspaceSkills.test.ts` fails if a skill names a missing tool, a declared tool isn't mentioned in its procedure, or a non-core tool belongs to no skill.
- **One AI per business** (docs/yourAi.md): a workspace has exactly one `assistant`, made at sign-up and never added or deleted (the `assistant` permission is `read` and `update` only). `services/assistants/workspaceAi.ts` resolves it (`findWorkspaceAi`, `workspaceAi`: the oldest row, so leftover rows are tolerated); `GET /api/organizations/:org/assistant` returns it, and `ownedAssistant` only accepts its id on `/assistants/:assistantId/...` routes. It answers customers on every channel and talks with the owner and their team; the visitor bot never gets owner tools (the line is the channel, not a separate AI). `assistant.job` is one plain sentence read by its prompts. Never take a choice of AI from a client.
- **Channels** (docs/yourAi.md, "Channels"): each website chat and customer WhatsApp is a `connection` whose `assistantId` is the AI. A website is provider `website` (one per origin per workspace, `externalAccountId` = origin, no provider module in `connections/registry.ts`); `services/connections/website.ts` keeps it in step with `assistant.allowedOrigins` (written both ways until that column goes) and resolves the widget's id, so `data-site="<connectionId>"` and `data-bot` both reach the AI. `PATCH .../connections/:id` changes provider settings only. Owner chat: `list_channels` (read only). Sign-up with a website makes that website the AI's channel.
- **Rules** (docs/yourAi.md, "Rules"): `member_rule` rows (`services/memberRules/`, `routes/memberRule.routes.ts` under `/api/organizations/:org/rules`; assistant read, assistant update to change): a one-line `rule` or `steps` (`when` + 2–10 steps). Rules belong to the workspace (`organizationId`, no `assistantId`), since its one AI follows them all. `draftRuleFromText` drafts from plain words; the owner chat shows a `ruleDraft` card saved by `POST /api/workspace-agent/chats/:chatId/blocks/:blockId/rule-draft` (tools `draft_member_rules`, `save_member_rules`, `update_member_rule`, `order_member_rules`, `delete_member_rule`; skill `member-rules`). `assistant.behaviour` is no longer read or written.
- **Team chat apps** (docs/teamChat.md): WhatsApp agents (one per person) and Slack talk to the owner assistant through `services/teamChat/` (one adapter per app; `thread.ts` `ownerThread` is the person's one shared `workspace_chat` with the AI, also their dashboard chat: `POST /api/workspace-agent/chats` with an `organizationId` returns it) and the connector framework in `services/connections/` (provider registry, signed `POST /api/connect/:provider/webhook`, `connection_event` then the `team-chat` job). Turns act as the linked member through a short server-side session, so every permission check applies; tools in `confirmFirstTools` are held until a button or an exact "yes". Alerts go through `teamChat/notify.ts` (`alertTeam`), sent as the AI, to every app a recipient linked; callers email the rest.
- **Customer WhatsApp** (docs/customerWhatsapp.md): the business's own number is the `whatsapp_business` connection (pasted ids and token, answered by the AI). Its webhook feeds `services/customerWhatsapp/`: a `channel: 'whatsapp'` conversation per number and customer, the visitor answer pipeline with `playbooks/whatsapp.md`, one answer at a time per conversation, free text only inside the 24-hour window (else the template or a draft), and staff replies sent through the Graph API.
- **Chat UI blocks** (docs/channels.md, wave 4): the visitor chat's `send_blocks` tool shows at most one block per reply (`choices`, `list`, `checklist`, `contactForm`). `schemas/chatBlock.schema.ts` holds the model's input and the stored `message.blocks`; `services/chat/blocks.ts` writes every block's plain-text fallback (never the model's). A tap is the visitor's message with `blockReply` and the option's text; the contact form goes through `captureChatLead`, keyed to its turn. WhatsApp sends reply buttons or a list inside the window (`customerWhatsapp/blocks.ts`), numbered text otherwise.
- **Sign-up** (docs/focusedProduct.md, "Shorter onboarding"): four steps in the web: name your AI, add your website (skippable), connect your WhatsApp for alerts (skippable; the same link as Channels), install the chat (the embed code, or the WordPress plugin with the AI's id). `POST /api/workspaces` (after the website step) creates the workspace, its one AI with the chosen `aiName` (else `defaultAiName`; answering the website when one is given), starts reading the website and opens the person's owner thread with the AI's first message (`aiFirstMessage`); `PATCH .../workspace` edits the name, business profile and ideal customer profile. `config/onboarding.config.ts` holds those defaults.
- **API keys** exist for the WordPress plugin's site sync (`packages/wordpress`): owners and admins create and revoke them in Workspace settings (`routes/apiKey.routes.ts`). A key (`Authorization: Bearer wp_live_…`) may only call `GET /api/v1/me` (its workspace) and routes needing `assistant` read or update (`apiKeyPermissions`): the plugin reads the AI (`GET .../assistants/:id`) and finds, adds and re-reads its website under `.../business/sources`. Everything else stays session-only. There are no outbound webhooks.
- **Changing visitor behaviour:** edit or add a playbook and compose it in `visitorPrompt.ts`; industry specifics come from knowledge and the owner's guidance (the AI's rules and `goalNotes`, formatted by `services/memberRules/prompt.ts`; tone-tagged rules get their own "Your voice" section), not per-industry prompts. Facts belong in notes, never in rules.
- User, website and visitor text is always quoted as data in prompts, never trusted as instructions.

## Model calls

- Every model choice lives in `config/models.config.ts`: the GPT-5.6 tiers (Luna, Terra, Sol) with prices, each one-shot task's model and reasoning effort, the two chat agents' models, and the embedding and image models. One-shot tasks use the cheapest tier that does the job (mostly Luna); chat uses Terra, and will follow the workspace's payment plan once plans exist. GPT-5.6 rejects `temperature`; use reasoning effort. Don't set models anywhere else.
- One-shot model calls go through `services/ai/llm.ts` (`generateText`, `generateObject`) with a `task`; pass `usage` to record cost in `ai_usage_event`. Agents get their model and settings from `agentModel(...)`.
- `bun run eval:retrieval` measures retrieval on a question set (`scripts/evals/*.json`): hybrid alone versus reranked by Jev. Add real visitor questions there before changing retrieval or turning on reranking.
- Knowledge has one layer, **Your business** (docs/yourAi.md): every `knowledge_source` (and its chunks, shared blocks, corrections and index runs) belongs to the workspace by `organizationId`. `services/knowledge/owner.ts` holds `ownedBy` (the workspace's rows), `lockOwner` (the workspace row, before changing sources or requesting runs) and `knowledgeChanged` (refreshes the AI's overview). Routes live in `routes/knowledgeSources.routes.ts` under `/business`. Gaps and conversations stay with the AI (`assistantId`).
- The AI's prompts carry a short catalogue of what it learns from (`services/knowledge/catalogue.ts`). Visitors only ever see website addresses and titles; files are "a document from the business" and passages without a public address never carry file names or note titles (`chat/passages.ts`).
- The AI's knowledge overview (`services/knowledge/overview/`) covers Your business and is rebuilt by the `refresh-overview` job after reading finishes or sources change. It reads page and document profiles, not full text, so its cost doesn't grow with site size, and an unchanged input skips the call.
- Knowledge gaps (`services/knowledge/gaps/`) are real visitor questions a bot couldn't answer, logged by its `note_unanswered` tool (never guessed). Reworded repeats merge by meaning (embeddings), and open ones are re-checked against the bot's own search whenever knowledge changes, so answered ones close themselves.
- Retrieval (`services/knowledge/retrieval.ts`) is hybrid: vector search and Postgres full-text search (`search_vector` columns, `english` config) each rank candidates, and reciprocal rank fusion merges them, so exact terms like product names and prices are found. Notes rank slightly higher, and website passages a note overrides carry an `outdated` marker with what the owner said. On the first eval set hybrid already put the right passage in the top five for every question, so Jev reranking (better first place, about +430 ms) isn't in the chat path; revisit with `eval:retrieval` on harder sets, with its own limiter.
- Notes are facts the owner told the bot in chat: `knowledge_source` rows with `kind: 'note'` (text in `cleanedText`, no stored file). They're embedded inside the save request (`services/knowledge/notes.ts`), so they're searchable at once, and rank slightly above website text. Before a note is saved, `POST .../notes/conflicts` checks the website; if a page disagrees, the helper shows a confirmation card and only `save_confirmed_fact` (or tapping the card) saves it, recording the override in `knowledge_correction`. After a re-read, changed pages are compared with those overrides (`corrections/checkCorrections.ts`) and open disagreements wait for the owner's decision. Gaps, fact-conflict checks and search live in `routes/knowledge.routes.ts`, notes and decisions in `routes/knowledgeSources.routes.ts`; the helper's knowledge tools in `workspaceAgent/knowledgeTools.ts`.
- Website path rules (`includePaths`, `excludePaths`) are prefixes, or one page when they end in `$` (`web.ts` `ruleMatches`). A new website's articles, listings and other-language copies are added as exclude rules once before its first read (`scopePlan.ts`, recorded in `scopePlan`; docs/yourAi.md); widening the rules starts a read.
- Reading a website (`crawl.ts`, docs/yourAi.md): the known pages (sitemap, earlier pages), then every loaded page's links, always, up to `maxWebsitePages` (500). Each page is a plain request first (304 unchanged, documents), then HTML through `services/knowledge/pageLoaders/` (`loadPage`: Cloudflare browser session, then its one-page tool, in the config's `pageLoaders` order), then the plain HTML. Bot-protection pages fail the page (`PageBlockedError`). Nothing outside `pageLoaders/` knows about Cloudflare or puppeteer; tests run without Cloudflare (`test/setup.ts` blanks its keys), so they exercise the plain path.
- Deleting a source never waits for reading: its runs are closed, and every stage re-checks its run before writing. A deleted website page stays as an excluded marker without content, so a refresh can't add it back.
- The worker writes a heartbeat (`service_heartbeat`) every 30 s. With work queued and no beat for 2 minutes, `preview/status` reports `paused` and the Knowledge page says reading is paused. Don't run the dev worker while running integration tests: both use the local database and queues, so it would take the tests' jobs with real provider settings.
- Install status comes from the widget's heartbeat: each `/api/widget/:id/launcher` fetch (at most one per visitor every 5 minutes, browser-cached) and each chat `bootstrap` records the site as working, notAllowed or notLive in `widget_install` (remembered in memory for 5 minutes so repeat loads cost no queries; throttled in the database too; rejected sightings capped at 10 per bot). Never trust it for access control — it only informs the owner.
- Public widget requests read the bot's live/origin/tracking settings through `services/widget/site.ts` (30 s in-memory cache, cleared on PATCH), not a query each.
- Website insights (`services/insights/`) are opt-in: `assistant.tracking` (boolean, off by default) is the master switch, and `assistant.trackingOptions` (jsonb `tTracking`: `visits`, `location`, `device`, `chat`, all on by default) is what it counts while on; both are `PATCH .../assistants/:id` fields. `countedTracking` (in `collect.ts`) combines them: all off while the switch is off. The launcher config sends that as `tracking`, the widget only sends the events and fields it allows, and the `collect` beacon is ignored while nothing is counted and drops what's off (views and sources need `visits`, country `location`, device and browser `device`, opens and suggested-question taps `chat`). Home's visitors step is `null` unless `visits` is counted. Beacons are counted in memory and flushed to daily totals (`site_stat_daily`) every 15 s; unique visitors use a daily HMAC of IP + user agent in `site_visitor_daily`, pruned after 2 days. Keep it aggregate-only: no per-visitor rows beyond that, no cookies, no full URLs. `GET .../assistants/:id/insights?days=7|30|90` reads them. Limits live in `config/tracking.config.ts`.
- Support (`services/support/`, docs/support.md): the visitor chat's `hand_off` tool sets `conversation.needsHumanSince` and a summary, alerts the owners once until the conversation is resolved (email always, WhatsApp or Slack when linked), and drafts a suggested reply in the background. A member's reply (`role: 'staff'`) sets `handledBy: 'human'`; from then the AI stays quiet (the widget gets a `team` event instead of a reply) until someone hands it back (`release`). A staff reply or handing it back clears `needsHumanSince`, so it leaves Needs you (the inbox filters: `needsYou`, `aiHandling`, `closed`, `all`). The open widget polls `GET /api/widget/:id/conversations/:id/updates` for staff messages. Visitors see staff first names only, never summaries or drafts.
- Your replies teach the AI (docs/support.md): after a staff reply to a conversation that needed a person, `support/noteOffer.ts` (`draftNoteOffer`, task `noteOffer`) decides whether the answer is general business knowledge and drafts a note. A dashboard reply stores it on the reply (`message.noteOffer`) for the inbox card; `reply_to_conversation` sends `noteOfferIn: 'chat'` and holds `add_knowledge_note` behind a Save / Not now confirmation instead. Saving goes through the normal note path with `fromMessageId`, which makes the note `discoveredVia: 'reply'` (an answer learned) and clears the offer; `DELETE .../messages/:messageId/note-offer` is Not now.
- This month's numbers (`GET /api/organizations/:org/stats/month`, `services/workspace/monthStats.ts`, `conversation` read): customers answered and how many started outside the workspace's opening hours in its time zone (`organization.businessHours`, `organization.timeZone`; 08:00–18:00 weekdays while unknown, UTC without a zone; `services/workspace/businessHours.ts` `outsideHoursSql`), leads caught in chat, those won this month and their value, conversations handed off this month (`conversation.handedOffAt`, set by the handoff that alerts) and answers learned, plus the website funnel: website visitors (from insights; `null` while `assistant.tracking` is off), visitors who started a chat (non-test website conversations created this month), then leads caught and won. The web shows them at `/`; the AI's chat is `/chat`.
- Opening hours (docs/glossary.md) are read, never typed: `knowledgeChanged` queues the `business-hours` job (stately, one per workspace, 30 s settle), which waits out reading and runs `services/workspace/hoursFromKnowledge.ts` (task `businessHours`): the AI's own search for the hours plus every note, notes winning. Found hours overwrite `organization.businessHours` (seven days, Monday first, `HH:MM` ranges) and may set `timeZone` when the text names one; nothing found leaves them alone. The browser's time zone comes with `POST /api/workspaces` and a one-time `PATCH .../workspace` (`timeZone`, validated as IANA). `GET .../business` returns `businessHours` and `timeZone`.
- The tell box on Your business: `POST .../business/notes/drafts` (`draftNoteFromText`, task `noteDrafts`) drafts one note from the owner's words (an instruction comes back as `rule`; a matching title gives that note's id), then the web runs the usual website check and note save.
- Lead statuses: a lead's `status` is `new`, `contacted`, `won` or `lost` (`leadStatuses` in `db/schema/product/lead.ts`; new and contacted are open). New leads start `new`. `services/leads/setStatus.ts` (`setLeadStatus`) is the one path for changing it, used by `PATCH .../leads/:id` (`status`) and the owner chat (`set_lead_status`, skill `lead-status`): it keeps `closedAt` in step (set for won and lost, cleared otherwise) and logs a `status_changed` timeline entry in the same transaction. `lead.value` is what a won lead was worth, in minor units (cents); there is no workspace currency yet. `GET .../leads?status=` takes a status or `open`.

## Tests

- `bun run test` runs the unit tests only (seconds).
- `bun run test:crawl` reads a real website (xvelopers.com, 5 pages) the way a customer's is read: the real worker, Cloudflare's browser, Jev and embeddings, with the keys in `.env`. About 1.5 minutes and a few cents. Run it when the reading code changes, not for other work.
- Tests must run the production path: no `NODE_ENV === 'test'` branches, stand-in servers or blanked keys in new tests. `bun run test:integration` is the older suite built on stand-in servers; it is slow and not run by default.

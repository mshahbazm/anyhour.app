# Anyhour

**Open-source AI for your website that answers visitors, catches leads, and pings you on WhatsApp when someone wants to buy.**

- Answers customers from what's on your website, files and notes, day and night.
- Catches leads: who they are, what they want, and whether you won them.
- Pings you on your own WhatsApp (or Slack) when a lead comes in or it needs you, and learns from your reply.
- Shows the proof each month: visitors → chats → leads → won.

Customers can also reach it on your WhatsApp Business number. You own your leads and customer chats, and can self-host it.

## Development

Anyhour is a Bun workspace with a Hono API in `packages/api` and a React/TanStack Router dashboard in `packages/web`.

## Local setup

1. Run `bun install`.
2. Fill `packages/api/.env` using `packages/api/.env.example`. Set `BETTER_AUTH_URL=http://localhost:3001` and `FRONT_END_URL=http://localhost:3000` for local development. The web client's `VITE_API_URL` defaults to `http://localhost:3001`; see `packages/web/.env.example`.
3. Create the PostgreSQL database named by `DATABASE_URL`. Ensure that server has pgvector available, then run `bun run db:migrate`.
4. Run `bun run dev` and `bun run --cwd packages/api worker` in separate terminals. Open `http://localhost:3000` for the current web shell.

For Google sign-in, register `http://localhost:3001/api/auth/callback/google` as an authorized redirect URI in Google Cloud. For magic links, use a verified sender domain with Resend. Set `BETTER_AUTH_SECRET` to a random string of at least 32 characters.

For production, set `FRONT_END_URL=https://plus.xvelopers.com`, `BETTER_AUTH_URL` to the public API origin, and `VITE_API_URL` to that same API origin when building the web client. Register `<BETTER_AUTH_URL>/api/auth/callback/google` in Google Cloud. Serve the web SPA with an `index.html` fallback for client routes.

## Commands

- `bun run dev` — API and web development servers
- `bun run typecheck`, `bun run lint`, `bun run build` — checks
- `bun run db:generate` — generate a migration after changing Drizzle schema
- `bun run db:migrate` — apply committed migrations to the configured database
- `bun run db:seed:local` — create or refresh local owner, admin, member, and outsider accounts for manual testing; saves their sessions in an ignored file
- `bun run test` — run cleanup unit tests and HTTP integration suites against local PostgreSQL; each suite stops its servers afterward

The first migration enables pgvector and creates Better Auth's user/session tables. Later migrations add organizations and the product tables. The API serves assistant, knowledge, conversation, contact and lead routes. Magic links can create an account from either auth page; the register page also collects a name.

## Backend services

- `LLM_KEY` configures OpenAI chat and `text-embedding-3-small` indexing. `CHAT_MODEL` selects the visitor chat model.
- File uploads use Cloudflare R2. Set `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` together.
- pg-boss manages indexing jobs in PostgreSQL. Run one or more `packages/api` worker processes alongside the API. The worker handles discovery, page refresh, and the assistant-wide refresh schedule.
- Creating an assistant through `POST /api/organizations/:organizationId/assistants` with `{ "name", "websiteUrl" }` creates its first website source and queues indexing. Publish it after at least one page is ready.
- Public widget clients obtain a short-lived token from `POST /api/widget/:assistantId/bootstrap` on an allowed website origin. Use it for `/api/widget/:assistantId/*` conversation and chat routes. A separate random conversation token grants transcript access.

## API recovery and collection contracts

- Contacts, leads and assistant conversations accept `limit` (default 100, maximum 200) and `cursor`. Responses remain arrays. When another page exists, the exposed `X-Next-Cursor` header contains the last returned ID. Cursors are scoped to the requested collection; invalid or foreign cursors return `422 invalid_cursor`. Ordering uses creation time and ID, newest first.
- Each accepted chat message gets an independent reply using a history snapshot captured when it is accepted, regardless of the conversation's age. A new visitor message reopens a previously closed conversation. Closing the browser does not cancel the reply: the API finishes and saves it. A two-minute request timeout is configured in `packages/api/src/config/chat.config.ts`. There is no background reply recovery or age-based expiry.
- Application database connections use UTC, matching Drizzle timestamp encoding. Existing historical timestamps are not rewritten.
- Reusing a `clientMessageId` returns `409 duplicate_message`, preventing accidental duplicate processing. After a failed request, send a new message with a new ID. Streams report `generation_timeout` or `agent_failed`; failures do not block future messages. A process crash can leave a visitor message without an answer, but the next message is still accepted.
- Chat contact details come from visitor messages in that conversation. Email matching ignores case; supported international phone formatting is normalized without guessing a country code. Unsupported AI additions are omitted. An organization-local email/phone match reuses the contact and fills empty fields; conflicting nonempty details stay on the new lead. Existing contact data is not copied into public prefill or AI history. Conflicting email/phone matches to different contacts still return `409 contact_conflict`.
- Page and website refreshes use one resumable crawl flow: Cloudflare renders a single page with `limit: 1` or discovers a website with the existing 50,000-page ceiling. Crawls use `maxAge: 0` so refreshes check the origin rather than accepting cached crawl results. Page requests retain their source ID and parent and never discover other pages, including during HTTP fallback. Public documents and uploads retain their extraction paths. Scraped content is staged in R2; embedding retries reuse that content and successful processing clears it.
- The scheduler owns the automatic refresh date; settings can reset it. Finishing or failing a manual/page/website/upload run never postpones it. Page and website requests remain independent.
- Website discovery persists page items and counters together; recovery repairs active-run counters without rewriting completed history. HTTP fallback follows deeper eligible links, including links from unchanged HTML, up to the existing 50,000-page technical limit. This can increase crawl and embedding usage. Website page staging requires R2, including HTTP fallback.
- `apiFixes.test.ts` runs real HTTP routes with a deterministic Agents SDK model. `crawlRecovery.test.ts` uses real HTTP routes and a worker with local storage, embedding, and crawl-provider fixtures. The roles suite uses local provider fixtures as well.

For deployment, stop the old API/worker processes, apply the generated migrations explicitly, then start the updated API and workers together. Do not run old and new chat writers concurrently: the new schema removes reply recovery columns and indexes. Local migration verification does not deploy these changes to production.

## Knowledge ingestion responsibilities

The jobs are resumable stages of one ingestion flow. Stage services perform work; the controller chooses the next stage and the worker only connects queues and maintenance timers.

| Step / responsibility | Owner in `packages/api/src/services/` | Durable boundary / failure behavior |
| --- | --- | --- |
| Create a source and request indexing | `assistants/createAssistant.ts`, `knowledge/sourceOperations.ts`, `knowledge/runRequests.ts` | Source and initial run commit together; failed queue dispatch is recovered from the run. |
| Schedule, advance and recover runs | `knowledge/refreshScheduling.ts`, `knowledge/runOrchestrator.ts` | Scheduler owns refresh dates. Bounded recovery scans rotate through all active runs. |
| Discover links, start/poll/collect crawls | `knowledge/crawl.ts`, with `knowledge/cloudflareCrawl.ts` as provider adapter | Crawl IDs, poll deadlines, pagination and page items persist. HTTP fallback retains collected pages. |
| Fetch one page or document | `knowledge/fetchPage.ts`, `knowledge/documentText.ts` | Scope and resolved URL checks precede accepting evidence. |
| Extract, classify and profile | `knowledge/preparePage.ts`, `knowledge/cleanup/` | Text, decisions, deferral dates, profiles and pending usage are checkpointed. Preparation has its own attempt budget. |
| Store stage evidence | `knowledge/staging.ts` | Attempt-specific objects; the previous pointer remains valid until its successor is written. |
| Group repeated retained blocks | `knowledge/groupWebsite.ts` | Unreadable pages retry individually. Failed grouping writes use complete prepared text; deduplication cannot discard prepared siblings. |
| Chunk and request embeddings | `knowledge/chunk.ts`, `knowledge/embedding.ts`, `knowledge/embeddingCheckpoints.ts` | Valid batches persist by run, source and exact model/input hash; later batch or publication failure reuses saved vectors. |
| Publish page/upload knowledge | `knowledge/embedPage.ts`, `knowledge/uploadIndexing.ts`, `knowledge/chunkPersistence.ts`, `knowledge/sharedContent.ts` | Source content, chunks, shared references and item completion commit atomically. Failed refresh keeps the previous published index. |
| Own attempt leases and terminal progress | `knowledge/pageAttempts.ts`, `knowledge/runItems.ts`, `knowledge/pageOutcomes.ts` | Separate preparation/embedding budgets and monotonic attempt fencing prevent stale workers from publishing or counting twice. |
| Apply source status, archive and scope rules | `knowledge/sourceLifecycle.ts`, `knowledge/pageFailure.ts`, `knowledge/archivedPages.ts`, `knowledge/sourcePaths.ts` | Temporary failures preserve knowledge; confirmed missing pages follow archive/recheck deadlines. |
| Retrieve eligible knowledge | `knowledge/retrieval.ts`, `knowledge/sourceEligibility.ts` | Content, profiles and shared facts use the same assistant, inclusion, path and archive filters. |
| Answer using chat context and cite evidence | `chat/answer.ts`, `chat/messages.ts`, `chat/citations.ts` | Each reply uses its accepted message's history snapshot; citations must reference retrieved evidence. |
| Record usage and clean temporary data | `knowledge/preparationUsage.ts`, `knowledge/embeddingUsage.ts`, `knowledge/storageCleanup.ts`, stage/checkpoint sweepers | Accounting is separate from knowledge publication; durable deletion intents survive failed object deletes. |

`indexer.ts` handles upload discovery/dispatch and compatibility exports. Current request callers use the dedicated services. Services coordinate focused helpers instead of duplicating HTTP, storage, embedding, eligibility or terminal-transition rules inside route/worker handlers.

New migrations `0014` and `0015` add the stage-specific recovery fields, storage cleanup outbox and embedding checkpoints. Apply all generated migrations before starting the updated API and worker. A provider response can still be repeated if the process or storage fails before its first durable save: external AI calls and local persistence cannot commit atomically. Once saved, downstream retries preserve that work. These guarantees cover ingestion; chat replies themselves do not have background recovery.

## Website text cleanup

HTML pages use the crawler's HTML, or fetched HTML during HTTP fallback. Generated Markdown is not used for HTML pages. The extractor in `packages/api/src/services/knowledge/cleanup/` preserves ordered text blocks, heading context, tables, contact details and observed link destinations. It removes scripts/styles and non-text containers; it does not discard headers, footers, sidebars or short text merely because of their position or length. Text/Markdown documents retain their original text path.

Set `TYPESAFE_API_KEY` to enable `jev-1.13.0` classification. All blocks are considered. Full-page context is used when it fits; otherwise consecutive sections are sent with nearby context. Each block receives a knowledge, action, noise or uncertain decision. Only valid noise decisions with confidence at least 0.95 are removed. Missing credentials, unavailable/invalid responses, uncertain decisions and exhausted work budgets preserve the affected text. If every block would be removed, the original text is retained. These rules favor retaining useful facts over aggressive removal; confidence is not a guarantee of correctness.

The documented Jev limits are 32k tokens for state plus the longest question and 64k for state plus all questions. Without a published compatible tokenizer, this implementation conservatively budgets serialized UTF-8 bytes at 24k/48k including overhead, and splits further only after an explicit size rejection. Requests have a 45-second timeout and at most three immediate attempts. Per-page work stops at 512 HTTP attempts, 15 minutes of active processing, or eight preparation attempts. Embedding has a separate eight-attempt budget; deferred rate limits do not consume preparation attempts. Deferred rate limits are checkpointed. PostgreSQL coordinates two concurrent Jev requests and at most one request start per second across workers. Crawl polling falls back after 24 hours; repeated pagination cursors and 1,000-batch limits also trigger HTTP fallback.

After page preparation, a website-wide stage identifies repeated retained blocks from normalized text, region, local heading and link destinations. CSS classes, IDs and active-state attributes do not affect matching. Equal footer/header/sidebar/navigation blocks and contextual link blocks are stored and embedded once, with references to every originating page. Different prices, hours, destinations or contextual headings remain separate. This is conservative exact matching after normalization, not semantic merging. Shared facts remain searchable when any originating page is enabled and allowed by website path rules; citations point to an eligible page.

HTML extraction also preserves the ordered text/link segments in each block. After cleanup, code formats retained links as Markdown, for example `[Book a repair](<https://example.com/book?branch=central#slots>)`. Relative links use the actual fetched/provider document URL (including its trailing slash) or valid HTML base URL; HTTP(S), email and phone destinations retain their query parameters and fragments. Both page-specific and shared passages carry these links into embeddings and the answering model's knowledge results. Jev continues to classify the original text and link metadata; it does not generate destinations. Chunking keeps complete inline links together, prefers block boundaries, and fails explicitly if a link cannot fit the byte limit rather than truncating its URL. Source-page citations remain separate from action destinations.

Page hashes include the title, formatted content and `links-v3` format marker, so destination-only changes invalidate the index. Older indexes bypass conditional HTTP fetches on their next refresh, and older prepared checkpoints are fetched again before embedding. To upgrade existing indexes, run `bun run --cwd packages/api knowledge:reindex-links` to preview the number of affected pages/source refreshes, then add `--apply` to enqueue them. Add `--assistant <id>` to scope either command. This uses the configured database and providers; run the updated worker to finish the jobs. Existing knowledge remains searchable until each replacement succeeds. This format change needs no additional database migration.

Embedding chunks are bounded by UTF-8 bytes so multilingual text also fits the provider's token limit. Requests contain at most 128 inputs and 240k bytes of input text; shared blocks are embedded in batches. Vectors must match their input indexes, have 384 finite values, and be nonzero before they can be stored. Embedding calls have a 45-second timeout, at most two SDK retries, and an eight-minute work deadline. Chat request timeouts propagate to query embedding requests. Page-specific and shared retrieval use the same source eligibility rules.

Each page also gets a profile from at most 1,000 tokenizer-counted excerpt tokens, using `gpt-4.1-mini-2025-04-14`. Up to 250 tokens cover the title/headings; the rest samples complete sentences across sections. Profiles store a summary, purposes, topics and visitor goals. Action labels/destinations come from extracted source links. A failed profile never discards knowledge. `pageProfile`, `pageActions`, `cleanupStatus` and `cleanupStats` are stored on the source; shared text and its source references use `knowledge_shared_block` and `knowledge_shared_block_source`. AI usage events record cleanup, profile and embedding usage separately.

A saved page profile also produces one `knowledge_chunk` with `kind = 'pageProfile'`, the same non-null `sourceId`, and reserved position `-1`; normal content chunks default to `kind = 'content'` and start at position zero. Its text is ordered **title → purposes → visitor goals → action labels → topics → summary**, then trimmed from the end to at most **300 `text-embedding-3-small` tokens**. Empty fields and duplicate list entries are omitted. Exact action URLs stay in the source data and are returned only for complete matching labels, rather than consuming the profile embedding's token budget. Profile results deduplicate exact destinations and return at most 12 action links each; stored links remain complete. Profile changes update this embedding independently of content changes; normal indexing batches the additional vector with content vectors. Missing/failed profiles do not create a profile chunk or block ordinary content retrieval.

Chat searches both content and profiles with the same query embedding. It returns up to five content passages plus two page-profile matches, with the same assistant, inclusion, path and archive filters. Profile results support navigation and include saved action destinations; detailed factual claims still use content passages. Existing profiles can be embedded without crawling or another profile-generation call: preview with `bun run --cwd packages/api knowledge:backfill-profiles`, then add `--apply`; optionally scope with `--assistant <id>`. The command processes 100 sources at a time, skips unchanged profile chunks and uses the configured database and embedding provider. HTTP 304 refreshes also repair missing/stale profile chunks. Apply migration `0013` before running the updated API, worker or backfill command.

R2 objects are temporary checkpoints. HTML is replaced with extracted text as soon as extraction succeeds, and checkpoints are deleted after terminal page processing. Failed deletions retain a durable key or deletion intent for worker cleanup; an orphan sweep covers abandoned terminal-run objects older than 24 hours. No HTML history or content versions are retained by the application. New text and embeddings replace the searchable index atomically, preserving the last successful index if refresh fails. Source rows are locked before chunk writes, and overlapping runs cannot overwrite a source checked or indexed after their start, including HTTP 304 responses.

An explicit HTTP 404 or 410 archives the page immediately and excludes its specific and shared content from chat retrieval. One delayed pg-boss job rechecks it after three days for 404 or ten minutes for 410; no worker stays running for that delay. A new confirmed 404/410 after that deadline deletes the page's saved text, embeddings, profile, actions and shared-content references; shared facts belonging to other pages survive. Timeouts, rate limits and server errors never trigger this deletion: after the normal bounded fetch retries, the page stays archived for manual retry or a later normal website refresh. Successful re-indexing restores the page and clears the archive dates. The URL/status record remains for history and future discovery, and repeated missing responses do not restart the grace period. Source list/detail responses expose `archivedAt`, `deleteAfter`, `nextArchiveCheckAt`, `contentDeletedAt` and `archiveNotice`. The knowledge inspector displays these archive notices alongside source content and controls. Disabled sources and excluded website paths are not automatically rechecked. The existing worker recovery cycle repairs overdue queue dispatch if a process stopped between saving the archive and submitting its delayed job.

Apply the generated migrations before starting the updated API and workers. Existing sources gain the new cleanup and profiles on their next refresh. The cleanup, crawl and recovery integration suites use local provider fixtures to verify shared retrieval, permissions, restart recovery and storage cleanup. The roles suite also uses local provider fixtures. Disposable decision benchmarks are not required to run the application or its regression tests.


## Chat-first workspace

The signed-in app is agent-first and bot-centred, using one workspace implicitly. A bot switcher at the top of the sidebar selects the bot you're working on (with Edit name & picture and Create a bot); everything below is about that bot:

- **Train → Chat with <bot>**: a private chat in which the selected bot speaks as itself, learns about the business and reports on its activity. There is one ongoing helper chat per bot (no thread list). A new bot introduces itself and asks for its name, then for the website (or documents); a trained bot greets with new-lead and visitor-conversation counts and suggested questions. Tool steps stream inline; resolved choices collapse to the answer. Documents can be attached in the composer (paperclip or drag and drop). The Knowledge panel opens beside the chat (a drawer on narrow screens).
- **Train → Knowledge**: the same sources as a full page, with live indexing progress, add link/upload and source details (indexed text, refresh, include/exclude, delete).
- **On your website → Conversations**: chats between the bot and real visitors with full transcripts; private test chats are excluded.
- **On your website → Leads**: enquiries the bot collected, filterable by status, with contact details, summary, status changes, team notes and links to the originating conversation.
- **Test <bot>** opens a separate authenticated preview with the main website as a sandboxed backdrop and the bot on top; sites that block framing fall back to a plain background.

The page is chosen with `?view=knowledge|conversations|leads` (default: the chat). Each helper chat keeps its unsent draft, panel state and opening greeting. Light and dark themes follow the system setting.

### Going live: install and the website embed

The **Install** page walks through three steps: add the website origins where the chat may load (`allowedOrigins`), go live (`status: published`, which requires at least one ready page or document), and copy the snippet:

```html
<script src="https://<widget-origin>/embed.js" data-bot="<bot id>" data-api="https://<api-origin>" async></script>
```

The widget is its own deployable package (`packages/widget`), separate from the API and web app. `bun run --cwd packages/widget build` writes two static files for any static host or CDN:

- `dist/embed.js`, the loader every page gets: about 4 KB gzipped, no React. It does nothing until the page has loaded and the browser is idle, then draws the closed chat from `GET /api/widget/:id/launcher` (public, cached by the browser for 5 minutes). Serve it with a short cache (e.g. `max-age=300`) so updates reach websites quickly.
- `dist/chat-<hash>.js`, the full chat (React, about 190 KB gzipped), fetched only when a visitor hovers, focuses or opens the chat. Its name changes with its contents, so serve it with `cache-control: public, max-age=31536000, immutable`.

Page-speed tools therefore never see the chat. Set `VITE_WIDGET_URL` in the web app to the widget origin so the Install page shows the right snippet. Locally `bun run --cwd packages/widget dev` serves freshly built `embed.js` and `chat.js` on `http://localhost:3002` (root `bun run dev` starts it with the API and web app).

Only whitelisted websites can use a bot: the API issues a chat token only when the bot is published and the browser's `Origin` is one of the bot's allowed origins, and every widget API call checks that token and origin (CORS is likewise limited to those origins). On any other site the widget silently renders nothing.

The embed mounts in a Shadow DOM so the website's CSS can't affect it, shows a launcher with the bot's picture, and uses the public widget API (`launcher` for the closed chat; once opened, a `bootstrap` token → conversations and streamed messages). The conversation and its resume token are kept in the visitor's `localStorage`, so the chat survives page navigation. Bot replies render links as clickable (http/https/mailto/tel only) and open in the same tab, so the bot can send visitors straight to the right page. `GET /api/widget/:assistantId/picture` serves the picture of published bots publicly. Visitor chats appear under Conversations; private preview chats never do.

### How the visitor bot behaves

The owner picks a goal; Anyhour owns the prompts (`services/chat/goalInstructions.ts`):

- **answers** — answer accurately and link the relevant page; no unprompted sales or contact requests.
- **enquiries** — answer first, then move one gentle step toward buying or booking: a single relevant follow-up question or the exact booking/purchase/contact link from the knowledge, then an invitation to leave an email or phone. No pressure, repeated asks or invented offers, urgency or availability.
- **both** — answers plus the enquiry behaviour when a visitor shows buying interest.

For every goal, when the knowledge can't answer, the bot says so and offers to pass the question to the team. A visitor who shares contact details becomes a **lead** with `reason = 'question'` (the default is `'enquiry'`). We record these as leads rather than a separate inbox because a real person is waiting for a reply and needs the same follow-up workflow (status, notes, assignee); the Leads page marks them **Needs an answer**, and the bot's helper reports them so the owner can teach the missing answer.

### Documents

Uploads and public document URLs share one reader in `services/knowledge/documents/`: PDF, Word (`.docx`), text, Markdown, CSV and HTML, up to 10 MB. Formats are detected from the declared type or extension and must match their file signature (PDF `%PDF`, DOCX zip); text formats must not contain binary data. The upload request only validates and stores the original in R2 — text is extracted asynchronously by the worker's indexing step (then cached as the source's `cleanedText` for later refreshes). CSV rows become `Header: value; …` lines so each row stays meaningful as a chunk; HTML files go through the same block extractor as crawled pages. PDFs with little or no selectable text are treated as scanned: up to 30 pages are transcribed by the chat model from the PDF itself (Responses API file input); larger scanned PDFs and files with no readable text fail immediately with a clear message instead of retrying. Documents also get the same page profile as web pages (summary, purposes, topics, visitor goals) and a profile embedding, so the bot can point visitors to them.

### Bot pictures and the business profile

Bots can have a photorealistic profile picture of a fictional person. `POST /api/organizations/:organizationId/assistants/:assistantId/picture` with an optional saved `style` and free-text `description` first asks the chat model (via `services/ai/llm.ts`) to write a portrait brief from the workspace business profile and the bot's role, then renders it with the image model in `config/botPicture.config.ts` (falling back to the saved style prompt if the brief fails). Pictures are stored in R2 under `bot-pictures/` and served by an authenticated `GET` on the same path; `DELETE` removes it. Generation is limited to three per minute per person. The workspace business profile is the owner's `businessAbout` text, otherwise the indexed homepage's page profile.

`services/ai/llm.ts` is the shared helper for LLM calls (bot picture briefs, page profiles, scanned-PDF transcription): `generateText` and `generateObject` (Responses API, Zod-validated structured output) take SDK-typed model settings, timeouts, retries and an abort signal, and return classified `ApiError`s instead of provider messages.

The web client uses local shadcn/ui components built on Base UI, with shared neutral tokens for auth, chat, knowledge, and preview controls. Components live in `packages/web/src/components/ui`; `components.json` records the Base Nova registry configuration. The widget remains self-contained. Completed chat choices collapse to a saved result, with the original options still available for inspection.

The helper uses `@openai/agents` with separate bundled skills and tool definitions under `packages/api/src/services/workspaceAgent/`. Its fixed tool client forwards the current Better Auth cookie only inside the server to protected Hono routes; the model never receives cookies or selects credentials. Every route independently checks the user's permissions. Private helper history is stored separately from visitor transcripts. Closing the browser does not cancel an accepted turn. Failed/interrupted turns retain action outcomes and are never automatically replayed. Unknown write outcomes must be reconciled with current workspace state before retrying.

Preview endpoints are authenticated under `/api/organizations/:organizationId/assistants/:assistantId/preview/*`. They work for drafts, isolate preview history to its creator, and prevent real lead capture. Preview conversations do not appear in the customer conversation list. The self-contained `packages/widget` package supplies the preview UI; a public embed loader, publishing interface and lead management are not part of this milestone.

Apply generated migrations `0016`–`0018` before starting the updated API. `0018` adds the nullable bot `picture_key`, workspace `business_about`, and lead `reason` (default `enquiry`). `0017` adds the nullable workspace main website, nullable bot goal/notes, and persisted interactive chat blocks. It does not alter existing knowledge, deployment origins, memberships, or user accounts. No new environment variables are required; helper model/runtime settings are in `workspaceAgent.config.ts` and initially use the existing configured chat model. Helper usage is recorded on its persisted reply, independently of visitor chat usage.

Validation: run the package typecheck/lint/build scripts. `bun run --cwd packages/api test` includes the helper's HTTP authorization/recovery suite. For browser checks, install Chromium with `bunx playwright install chromium` from `packages/web` if necessary; then run `bun run --cwd packages/web test:e2e`. Browser tests start isolated API/provider fixtures and Vite on ports 3191/3190, use local PostgreSQL and ignored local test sessions, and do not call paid AI/storage providers. Run integration and browser tests sequentially because they refresh the same integration accounts.

### Chat-led setup and teams

Sign-up is four steps: name your AI, add your website (it starts reading; skippable), connect your WhatsApp for alerts (skippable) and install the chat (the embed code, or the WordPress plugin with the AI's id). Private previews never capture real leads.

The helper's workspace and team skills support workspace details, member/invitation lists, invitations, non-owner role changes, cancellation, and confirmed member removal. Better Auth remains authoritative. The helper cannot transfer ownership or delete a workspace. Team screens are deferred.

`GET/PATCH /api/organizations/:organizationId/workspace` reads/updates name and main website. Existing assistant updates accept nullable `goal` (`answers`, `enquiries`, `both`) and `goalNotes`. `POST /api/workspace-agent/chats/:chatId/blocks/:blockId/respond` accepts `value` and `clientMessageId`, resolves a saved block once, and streams the following agent turn. History responses include blocks; streams add `started` and `block` events. Blocks have fixed choice, action, summary/list, and confirmation renderers; model output never supplies executable UI or arbitrary endpoints. Pending choices expire after 24 hours or are superseded by a subsequent message. Exact typed choices can resolve a block; other free text continues the conversation. Removal confirmations are server-bound to a member and role, and permissions/state are checked again on execution.

`workspaceManagement.test.ts` exercises the HTTP/agent flow with deterministic model and mail transports. It does not send real email. Browser checks cover block persistence, source inspection, independent preview chat, saved drafts, a working website backdrop, blocked embedding fallback, and mobile layouts. Pause a live knowledge worker while running local fixture tests against the same database, and restart it afterward.

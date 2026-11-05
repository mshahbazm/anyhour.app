# Page reading provider

Reading a website (crawl.ts, web.ts) gets every page through **one page-reading provider**, chosen in config, the same way as the LLM and decision providers (docs/aiProviders.md). For now the only provider is **Spider** (spider.cloud). Cloudflare is removed: it was slow and unreliable.

Agreed with the owner (2026-11-05):
- The customer's website is never fetched from our own server. Pages, sitemaps, robots.txt and documents (PDFs etc.) all go through the provider, so our IP is never blocked and there is one reliable path.
- The provider "just does what's needed": callers ask for a page and get its content, or a clear reason it couldn't be read. Escalation lives inside the provider.
- Cost-effective: cheapest attempt first, stop at the first real content, spending caps.

## Shape

```
features: crawl.ts, web.ts, documents, sitemaps
   │  readPage(url, { kind: 'page' | 'document' | 'sitemap' }) → iReadPage
   ▼
base: services/pageReading/read.ts
   │  provider from config, "real content" check, spending caps,
   │  usage records, error classification (PageBlockedError, PageNotFoundError)
   ▼
providers: services/pageReading/providers/<provider>.ts   (spider.ts now)
      the only files that call a scraping vendor
```

- `tPageReaderProviderId = 'spider'` from an `as const` registry; `iPageReaderProvider` interface; registry `satisfies Record<tId, iProvider>`. Adding Firecrawl or a self-hosted reader later = one file + a registry line.
- Env: `PAGE_READER_PROVIDER=spider` (default) and vendor key `SPIDER_API_KEY` (one key per vendor, as with OpenAI/TypeSafe). Startup fails with the variable name when the selected provider's key is missing. Remove `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` if nothing else uses them.
- Responses parsed with Zod at the provider boundary.

## Escalation (inside the Spider provider)

Per URL, stop at the first attempt that returns real content:

1. `request: "smart"` with standard proxies (Spider picks plain HTTP or Chrome).
2. If the content is thin (see below): `request: "browser"` (full Chrome) with a short wait for the page to settle.
3. If blocked (403/429/challenge page): the same with Spider's stronger anti-block options (residential proxy / stealth), whatever Spider's current API offers. If Spider has a single built-in mode that escalates proxy/stealth when blocked, use it instead of separate calls.
4. All failed → `PageBlockedError` (blocked) or a classified failure. A 404/410 stops at once (`PageNotFoundError`). A failed read never overwrites a good earlier one (existing behaviour).

Ask Spider for **raw HTML** (documents: the raw bytes or its document text, whichever fits our existing document path), so cleanup, profiles and citations work unchanged. Read the official docs before building (https://spider.cloud/api/scrape/, https://spider.cloud/pricing, the docs index) and use real parameter names.

**Real content check** (base layer, provider-neutral): enough readable text after stripping scripts/styles, not a cookie banner or app shell, not a bot challenge (existing `isBlockedPage`). Thresholds in `config/knowledge.config.ts`.

## Cost

- Spider bills $1/GB of raw content + $0.0001/CPU minute; failed requests $0; each response reports its cost. Record every attempt in `ai_usage_event` (kind `pageRead`, provider `spider`, `costUsd` from Spider's reported cost) against the workspace and source.
- Caps in config: max cost per page and per website read; reaching a cap stops escalation for that page (it fails as blocked/too costly) and is logged.
- Unchanged pages: without our own 304 request, compare a content hash with the last read; unchanged → skip cleanup, profile and embeddings (where the real cost is).

## Done when

- No code fetches a customer's site directly (grep for `fetch(` in the knowledge reading path); Cloudflare loader files and config are gone.
- `bun run test:crawl` passes on Spider, and prints per page: attempts used, Spider cost, total cost.
- `typecheck`, `lint`, `build`, `test` pass; `packages/api/AGENTS.md` (reading section) and `.env.example` updated.

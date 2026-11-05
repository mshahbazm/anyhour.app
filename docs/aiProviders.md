# AI providers

Anyhour will be self-hosted, so the AI it calls must be switchable without touching features. Two kinds of provider, same shape:

- **LLM provider**: writing text and structured objects, embeddings, images. Only **OpenAI** for now.
- **Decision provider**: typed judgments (yes/no probabilities, one choice of several, a score) about some input. **OpenAI Decisions** (default) and **TypeSafe Jev**.

Goal: a new install needs only an OpenAI key. Adding a provider later means one new file per kind plus a registry line; no feature code changes.

## Three layers

```
features (cleanup, scopePlan, pageProfile, contactDetails, …)
   │  call task helpers they own, e.g. classifyBlocks(), createPageProfile()
   ▼
base methods: services/ai/llm.ts, services/ai/decisions.ts
   │  task → provider + model + limits from config, usage recording,
   │  error classification, retries/timeouts; plus a raw direct call
   ▼
providers: services/ai/providers/{llm,decisions}/<provider>.ts
      the only files that import a provider SDK or call its HTTP API
```

1. **Providers** implement one interface per kind and know nothing about tasks, usage tables or ApiError. They take a resolved model id and plain typed params, and return typed results with token usage.
2. **Base methods** are what the rest of the API imports:
   - LLM: `generateText(request)`, `generateObject(request)` (task-driven, signatures unchanged so existing callers keep working), `embed(...)`, `generateImage(...)`, and `callLlm(...)`, a raw direct call that takes an explicit model and settings for the rare case a task doesn't fit (scripts, evals). Same usage/error handling.
   - Decisions: `decide(request)` (task-driven) and `callDecisions(...)` (raw).
3. **Task helpers** stay in their features and only use base methods.

Nothing outside `services/ai/providers/` imports `openai` (the SDK) or calls `api.typesafe.ai`. **Exception:** the two chat agents use the OpenAI Agents SDK as their runtime (`@openai/agents`). They keep it, but take their model from the LLM provider (`agentModel(...)` moves behind it), and the SDK's key is set from the provider config in one place.

## Type safety

- `tLlmProviderId = 'openai'` and `tDecisionProviderId = 'openai' | 'typesafe'` come from `as const` registries; adding a provider widens the type and the compiler finds every switch.
- `iLlmProvider` / `iDecisionProvider` interfaces; registries are `satisfies Record<tId, iProvider>`.
- `generateObject` is generic over the Zod schema: the result is `z.infer<typeof schema>`.
- `decide` is generic over a `const` tuple of questions, so answers are typed by position and kind:
  ```ts
  const { answers } = await decide({
    task: 'blockCleanup',
    input,
    questions: [
      { kind: 'choice', name: 'b1', instructions, choices: [{ value: 'knowledge', description }, …] as const },
      { kind: 'predicate', name: 'isListing', instructions },
    ] as const,
  })
  answers[0].choice        // 'knowledge' | 'action' | 'noise' | 'uncertain'
  answers[0].probabilities // Record<that union, number>
  answers[1].probability   // number
  // any answer may instead be { kind: 'refusal', name } — the type says so
  ```
- Provider responses are parsed with Zod at the provider boundary; nothing downstream trusts raw JSON.

## Config (`config/models.config.ts`, env in `env.ts`)

- Keys are per **vendor**, one variable each: `OPENAI_API_KEY`, `TYPESAFE_API_KEY` (plus `TYPESAFE_API_URL` to point at another TypeSafe endpoint). A future vendor adds one key. `OPENAI_API_KEY` is the only OpenAI key name (`LLM_KEY` is gone).
- Each **capability** picks a provider: `LLM_PROVIDER` (`openai`, default) and `DECISION_PROVIDER` (`openai` default, or `typesafe`). There are no per-capability keys.
- Each provider names the vendor whose key it needs (`llmProviderVendors`, `decisionProviderVendors`, `vendorKeys` in `models.config.ts`). `env.ts` refuses to start when a selected provider's vendor key is missing, naming the variable, never the value. Providers read keys through `vendorKey(...)`, never `process.env`.
- Models stay in `config/models.config.ts`, never in env.
- Models and prices live per provider: `languageModels` (existing), and `decisionModels` (`openai`: `gpt-6-luna`, $0.10/M input, $0.01/M cached, output free; `typesafe`: the current Jev versions and their pricing as recorded today).
- `decisionTasks`: `blockCleanup`, `scopePlan` — each with its model per provider, timeout, retries, and request size limit (OpenAI: ≤400 questions per request; TypeSafe: the current 48 kB / rate-limit rules).
- Cross-worker rate limiting (the `public_rate_limit` slots) belongs to the TypeSafe provider only, configured from its limits; OpenAI Decisions uses normal retries on 429.
- Optional per task `serviceTier` for background LLM tasks (`pageProfile`, `knowledgeOverview`, `contactDetails`, `businessHours`) where the OpenAI Flex tier is available for the model: off by default.

## Usage records

`ai_usage_event.provider` is the provider id that served the call; `model` the provider's model id; cost from that provider's pricing (cached input priced separately when reported). Kinds unchanged (`cleanup` → keep the existing kind names for continuity).

## OpenAI Decisions mapping

Docs: https://developers.openai.com/api/docs/guides/decisions, https://developers.openai.com/api/reference/resources/decisions/methods/create

- `POST /v1/decisions` `{ model: 'gpt-6-luna', input, questions: [{ type: 'predicate'|'choice'|'score', name, instructions, choices|levels }] }`; 1–400 questions; answers in order, each possibly `refusal`.
- Block cleanup: the page and all its blocks (labelled by id) go in the shared `input` (cached when ≥1,024 tokens and repeated), one `choice` question per target block with the four existing criteria as choice descriptions. Split jobs over 400 targets. A refusal is treated like `uncertain` (keep the block).
- Scope plan: same mapping from the current Jev questions.

## Done when

- With only an OpenAI key, `bun run test:crawl` passes and cleanup keeps roughly the same blocks as before; report kept/dropped counts per page for both providers if a TypeSafe key is available.
- `typecheck`, `lint`, `build`, `test` pass in `packages/api`.
- `packages/api/AGENTS.md` "Model calls" describes the layers and how to add a provider.

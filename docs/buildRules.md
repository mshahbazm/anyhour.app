# How agents build in this repo (overnight waves, 2026-10-29)

These are notes for coding agents, written by the coordinator. They apply on top of `AGENTS.md`, the package `AGENTS.md` files and [glossary.md](glossary.md).

- **Don't over-engineer.** Build the smallest thing that does the job well, with modular, readable code that follows the existing patterns. Features may change after the user reviews them.
- **Simple UI** that a small business owner, freelancer or agency understands without help. Use the product words from the glossary, and don't scatter explanations around. It must work at phone width.
- **Chat-first:**
  - Anything with a page can also be added and changed from the owner chat (tools plus a skill).
  - Page input is a free-text box drafted by a typed `draft…FromText` function on `services/ai/draftFromText.ts`, then confirmed.
  - Decide each entity's scope: workspace or employee.
- **Tests:**
  - Only the important and critical paths, as HTTP integration tests (permissions, money, sending to customers, data that must not leak).
  - Run your new tests, the tests of the areas you touched, and unit tests. **Don't run the full `bun run test`**: it takes about 40 minutes, and the coordinator runs it.
- **Browser check:** look at your screens with the repo's existing headless browser e2e setup (`packages/api/test/*.e2e.ts` and how they sign in), at desktop and phone width. Fix what looks wrong. Don't print credentials.
- **Migrations:** one agent at a time generates them. Use `drizzle-kit generate --name=<feature>`, review the SQL, and apply it to the local DB.
- **Never:** open, print or log `.env` files; print or commit `packages/api/.local-test/`; switch branches; commit; push.
- **Report:** files, migrations, endpoints, tools, UX decisions, deviations, and the checks you ran with their results.

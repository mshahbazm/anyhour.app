# Anyhour web package rules

This package is the React/TanStack Router dashboard client. Follow the root `AGENTS.md` as well.

## Structure

- `src/routes/` contains thin TanStack Router routes. Keep business logic in `src/features/<feature>/`.
- Group a feature's UI and client code in that feature folder. Add subfolders only when they clarify a real feature.
- Call `packages/api` over HTTP. Keep secrets, database access, and provider SDKs in the API package. The future widget has its own UI and bundle.
- Route guards control client navigation. API endpoints must independently verify the session and workspace permission; never rely on a prior page load.
- Keep types next to their feature. Infer request types from validation schemas where practical. Add an explicit HTTP contract for external clients when one exists. There is no shared types package now.

## Auth

- Better Auth runs in `packages/api`. Use its browser client for Google and magic-link flows and session checks. Do not add password or custom JWT auth.

## Reliability

- Document browser-safe build variables in this package's `.env.example`; never put secrets in `VITE_` variables.
- Handle expected API failures with clear messages; do not silence failures with `any`.
- Add focused tests for behavior with a real failure risk. Run `bun run typecheck`, `bun run lint`, and `bun run build` from this package before completion.
- Prefer the simplest implementation that meets the current product need. Avoid placeholder layers, duplicated patterns, and speculative integrations.

# Development

Everything needed to run, test and deploy Anyhour from source. For how the pieces work inside, see [architecture.md](architecture.md).

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

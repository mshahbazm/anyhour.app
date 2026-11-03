# Anyhour workspace rules

- Use Bun for installing dependencies and running scripts. Workspace packages live in `packages/`.
- `packages/api` is the Bun/Hono backend and owns Better Auth and Drizzle. `packages/web` is the React/TanStack Router client. Add the self-contained `packages/widget` when widget development starts.
- Do not create a shared package solely to avoid a little duplication. Extract one when two real consumers need the same stable code.
- Use camelCase for files, variables, functions, and application data fields. Interfaces start with `i` and type aliases with `t`, followed by PascalCase (for example, `iChatbot` and `tChatbotId`). React components use PascalCase. Framework-mandated route filenames are exceptions.
- Read a package's `AGENTS.md` before changing that package. User instructions take precedence over these rules.
- For TypeSafe or Jev work, read `.agents/skills/typesafe-ai/SKILL.md` and the live documentation it references.
- Never open, print, search, diff, or log `.env` files or their values. Let the app and CLI load them directly when running commands.
- Use the product words in `docs/glossary.md` in UI copy, prompts and code; don't introduce new terms for existing concepts.
- Keep changes focused. Run the relevant typecheck, lint, and build scripts before reporting implementation complete.

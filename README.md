<div align="center">

# Anyhour

**Open-source AI for your website that answers visitors, catches leads,<br>and pings you on WhatsApp when someone wants to buy.**

[Website](https://anyhour.app) · [Docs](docs) · [Self-host](#quick-start) · [License](#license)

</div>

---

## Why Anyhour

- 💬 **Answers customers 24/7** from your website, files and notes.
- 🎯 **Catches leads**: who they are, what they want, and whether you won them.
- 📲 **Pings you on WhatsApp or Slack** when a lead comes in or it needs you, and learns from your reply.
- 📈 **Shows the proof** each month: visitors → chats → leads → won.
- 🔓 **You own your data.** Self-host it, or use the cloud at [anyhour.app](https://anyhour.app).

Customers can reach it in your website chat or on your WhatsApp Business number.

## How it works

1. **Name your AI** and give it your website. It reads every page.
2. **Install the chat** with one script tag, or the WordPress plugin.
3. **Get leads.** Your AI answers, collects contact details, and messages you when someone is ready to buy.

```html
<script src="https://<widget-origin>/embed.js" data-bot="<your AI id>" data-api="https://<api-origin>" async></script>
```

The embed is about 4 KB and loads the full chat only when a visitor opens it, so it won't slow your site down.

## Quick start

You need [Bun](https://bun.sh) and PostgreSQL with [pgvector](https://github.com/pgvector/pgvector).

```bash
git clone https://github.com/mshahbazm/anyhour.app.git
cd anyhour.app
bun install
```

Copy `packages/api/.env.example` to `packages/api/.env` and fill it in, then:

```bash
bun run db:migrate
bun run dev          # API, web app and widget
bun run dev:worker   # in a second terminal: reads websites and documents
```

Open http://localhost:3000.

See [docs/development.md](docs/development.md) for sign-in providers, production settings and tests.

## Tech stack

| Package | What it is |
| --- | --- |
| [`packages/api`](packages/api) | Bun + Hono API, Better Auth, Drizzle, pg-boss jobs |
| [`packages/web`](packages/web) | React + TanStack Router dashboard, shadcn/ui |
| [`packages/widget`](packages/widget) | The website chat, in a Shadow DOM |
| [`packages/wordpress`](packages/wordpress) | WordPress plugin |

## Commands

| Command | Does |
| --- | --- |
| `bun run dev` | Start the development servers |
| `bun run typecheck` · `lint` · `build` | Check and build everything |
| `bun run test` | Run the integration tests |
| `bun run db:generate` | Create a migration after a schema change |
| `bun run db:migrate` | Apply migrations |

## Documentation

- [Development and deployment](docs/development.md)
- [Architecture notes](docs/architecture.md)
- [Glossary](docs/glossary.md): the product's words
- More in [`docs/`](docs)

## Contributing

Issues and pull requests are welcome. Read [AGENTS.md](AGENTS.md) for code conventions and run `bun run typecheck`, `bun run lint` and `bun run build` before opening a PR.

## License

[AGPL-3.0](LICENSE). Use, change and self-host Anyhour freely. If you run a changed version as a service for others, share your changes under the same license.

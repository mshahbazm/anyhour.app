# Anyhour: first chatbot

## First release flow

1. Enter one public website URL.
2. Create a chatbot from its pages.
3. Review the pages it can use and test its answers.
4. Copy an embed snippet into an approved website.

The backend now supports creation, crawling, chat and leads. The dashboard remains an authentication shell; do not present placeholder content as real customer data.

The initial content-indexing choice is recorded in [embeddingDecision.md](embeddingDecision.md).

Owner notifications on WhatsApp (alerts plus "send"/"skip" replies through a personal WhatsApp agent) are documented in [whatsappOwnerAlerts.md](whatsappOwnerAlerts.md).

## Navigation

Keep the global navigation small: **Chatbots** and **Settings**. A chatbot has **Overview**, **Sources**, and **Preview & install**. Keep the title left and tabs right on wide screens; stack them on narrow screens.

| Page | Job |
| --- | --- |
| Start | Enter a website URL and create a chatbot. |
| Chatbots | Find existing chatbots or start another. |
| Chatbot overview | See conversations and leads for this chatbot. |
| Sources | Review website pages; add files and YouTube links later. |
| Preview & install | Preview the bottom-right chat bubble and get the embed snippet. |
| Settings | Account and workspace settings when implemented. |

Leads and conversations have API support but need dashboard UI. Analytics, shared knowledge, integrations, and social publishing remain later product work. Keep sources scoped to each chatbot for now. Revisit sharing once there is a real need across multiple chatbots.

## Application boundaries

- `packages/api`: the Bun/Hono HTTP API. Better Auth and Drizzle live here; future web, widget, and mobile clients call it.
- `packages/web`: the React/TanStack Router dashboard client. It calls the API over HTTP.
- Future `packages/widget`: a small, self-contained React build for public chat. A tiny embed script can load it in an iframe on approved sites. The dashboard preview can load the same widget.
- Future mobile and desktop apps call the API. Their UI and platform integrations will be planned when those apps are built.

Do not create a shared package until two real consumers need stable shared code. Keep widget assets and runtime separate from dashboard authentication and bundle.

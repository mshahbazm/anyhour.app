---
name: add-knowledge
description: Teach yourself from a website, a single page, a public document link, uploaded files or facts typed in chat, into Your business.
tools: list_sources, add_source, search_knowledge, add_knowledge_note, list_knowledge_notes, update_knowledge_note, remove_knowledge_note, save_confirmed_fact, resolve_website_change, indexing_status, my_sources
---

# Add to what I know

Everything I know is **Your business**: the business's own website, files and facts about it, including numbers, links and addresses the owner tells me, even when they say when to share them ("if someone asks for our WhatsApp, give them wa.me/123" is a fact). Behaviour (tone, always or never, what to find out first, steps, when to hand over) is not knowledge: it's my Rules (member-rules skill).

After saving, say so in one line: "Saved to your business" (for a source: "Reading it now").

Websites, pages and documents:

1. Call `list_sources` first so you don't add something twice. `my_sources` gives a short overview.
2. Decide the kind from what the user gave:
   - a site's home address → `add_source` with kind `website` (reads the whole site);
   - a specific page → kind `webPage`;
   - a link to a PDF or document → kind `publicDocument`.
     Only ask "the whole site or just this page?" when it's genuinely unclear.
3. Reply in one sentence: you're reading it now (the Your business page shows progress). Don't call it ready — reading continues after your reply.

Facts typed in chat (prices, opening hours, policies, product details, answers to common questions) are a living memory, one note per topic.

1. Call `list_knowledge_notes` to find a note that already covers the topic. When the owner asks what you tell visitors about something, call `search_knowledge` and answer with where you learned it.
2. Saving: if a note already covers the topic, call `update_knowledge_note` with its full new text: keep what's still true, change what changed, drop what no longer applies. Only for a new topic call `add_knowledge_note` with a short title and clear sentences in the user's words. Use `remove_knowledge_note` when they say a whole topic no longer applies.
3. Saving checks the website for you. If a page says something different (any fact, not only prices), nothing is saved: the owner sees a confirmation card comparing the page with your new answer. Add at most one short sentence and end your turn.
4. The owner answers with the card's button or in their own words. On a yes, call `save_confirmed_fact` with the card's `confirmationId`: it saves exactly what the card showed and remembers which pages it overrides. If they keep the website's answer, save nothing. If they change the fact instead, save the new version, which checks again.
5. Confirm in one sentence. If it differs from the website, name the page to update so visitors see the same thing, and say you'll check with them if that page changes.

Website changes waiting for a decision (in your context) mean a page changed and now disagrees with a fact the owner told you. Until they decide you keep using their version. Tell them what the page says now and what you've been saying, and ask which to use. Then call `resolve_website_change`: `keep` for their version, `useWebsite` to follow the page (their note is rewritten to match it).

Files: users attach PDF, Word, text, Markdown, CSV or HTML files (up to 10 MB) with the paperclip or drag and drop, or with Add on the Your business page. Files attached in this chat go to Your business. Never ask for file paths or contents. A message saying files were uploaded means they're already queued.

Never invent a website. A user giving a URL is permission to add it; don't ask for confirmation again. Use `indexing_status` only when the user asks how it's going — don't poll.

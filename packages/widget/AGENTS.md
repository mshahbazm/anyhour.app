# Anyhour widget
Follow the root workspace rules. Keep this package self-contained: React presentation components accept data and callbacks; authentication and dashboard state belong to the host. Do not import the web or API package. Use Bun for checks and builds. Public website embedding is a separate transport/entrypoint from the authenticated dashboard preview.

## Website embed

- `src/embed/loader.ts` is all a website loads up front (`dist/embed.js`, about 4 KB gzipped). Never import React, `botChat`, or other heavy code into it: draw the closed chat with plain DOM in `launcherView.ts`, mirroring `launcher.tsx` class for class. It runs only after page load and idle, so page-speed scores are unaffected.
- The full chat (`src/embed/chat.tsx`) is a separate bundle fetched on intent (hover, focus, open). It registers `window.anyhourChat` and takes over the loader's button. `scripts/bundle.ts` builds both; the chat file name is content-hashed for long CDN caching.
- `tracker.ts` sends website insights in batched beacons, only what the launcher config's `tracking` options allow (all off unless the owner turned visitor counts on): page views only with `visits`, time zone only with `location`, window width only with `device`, chat opens only with `chat`. Never add cookies, stored visitor IDs, query strings or full referrer URLs.

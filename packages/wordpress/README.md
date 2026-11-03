# Anyhour WordPress plugin

"Anyhour – your AI" puts the chat on a WordPress site and, with an API key, asks your AI to re-read the site when content changes. Plain PHP 7.4+, no build step and no dependencies. It is not a Bun workspace package.

```
anyhour/              the plugin (this folder is what goes in the zip)
  anyhour.php         header, constants, bootstrap
  includes/
    class-options.php      settings and sync state
    class-client.php       Anyhour API calls (wp_remote_request)
    class-embed.php        the embed snippet in the footer
    class-sync.php         "Sync my site now" and the debounced WP-Cron re-read
    class-settings.php     Settings → Anyhour
  uninstall.php            removes the plugin's options
  readme.txt               wordpress.org readme
build.sh                   makes dist/anyhour.zip
```

## Build and install

```sh
sh packages/wordpress/build.sh      # lints the PHP if php is installed, writes packages/wordpress/dist/anyhour.zip
```

In WordPress: Plugins → Add New → Upload Plugin → choose `anyhour.zip` → Activate. Then open Settings → Anyhour. For development, symlink or copy `packages/wordpress/anyhour` into `wp-content/plugins/`.

## How it works

- **Embed.** When "Show the chat" is on and an AI id is set, the plugin enqueues the loader in the footer and prints the same tag the Install page gives owners:

  ```html
  <script src="{widget}/embed.js" data-bot="{AI id}" data-api="{api}" async></script>
  ```

  Never on admin pages, feeds or embeds. Filters: `anyhour_show_chat` (bool, per page) and `anyhour_embed_attributes` (the tag's attributes).
- **Addresses.** The API defaults to `https://api.anyhour.app` and the widget to `https://widget.anyhour.app`. Override them under Advanced on the settings page, or in `wp-config.php` (this also locks the fields):

  ```php
  define( 'ANYHOUR_API_URL', 'http://localhost:3001' );
  define( 'ANYHOUR_WIDGET_URL', 'http://localhost:3002' );
  ```

  The chat only loads on origins in your AI’s allowed websites, so a local site must be allowed in Anyhour too.
- **Test connection** checks that `embed.js` is reachable, then:
  - with an API key: `GET /api/v1/me` and `GET /api/organizations/:org/assistants/:id`, reporting whether it's live and whether this site's origin is allowed;
  - without a key: `GET /api/widget/:id/launcher` with this site's `Origin`, as the chat would. Anyhour records that as a sighting on the Install page.
- **Sync** (needs an API key with the default permissions): finds the workspace (`/api/v1/me`), finds the top-level `website` source whose host matches this site, and queues a re-read (`POST …/sources/:sourceId/runs`). If there is none, it adds the site (`POST …/sources` with `kind: "website"`). Ids are cached in `anyhour_sync_state`. Publishing, updating or unpublishing a public post schedules one re-read an hour later (`anyhour_sync_delay`); further changes in that hour share it.
- **Options:** `anyhour_settings`, `anyhour_sync_state`. `uninstall.php` deletes them, the lock and notice transients, and the scheduled event (every site on multisite).

## Checks

```sh
find packages/wordpress/anyhour -name '*.php' -exec php -l {} \;
# With PHPCS and WordPress-Coding-Standards installed:
phpcs --standard=WordPress packages/wordpress/anyhour
```

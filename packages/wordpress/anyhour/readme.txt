=== Anyhour – your AI ===
Contributors: anyhour
Tags: chat, ai, chatbot, lead capture, live chat
Requires at least: 5.8
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Put your Anyhour AI on your website. It answers visitors, captures enquiries and alerts you.

== Description ==

Anyhour gives small businesses their own AI. It learns your business from your website and documents, answers visitors in a chat on your site, captures enquiries and lets you know when someone needs you.

This plugin adds the chat to your WordPress site without editing your theme:

* Enter your AI’s id and switch the chat on. It appears on every public page.
* The chat loads after your page has finished loading, so it won't slow your site down.
* Optional: add a Anyhour API key so your AI re-reads your site when you publish or update posts and pages (at most once an hour), or whenever you click "Sync my site now".

You need a Anyhour account. Your AI’s id is on the Install page in Anyhour: it is the `data-bot` value in the embed code.

= External service =

This plugin connects to Anyhour, a third-party service:

* On public pages, visitors' browsers load the chat script from the Anyhour widget address and talk to the Anyhour API.
* "Test connection" and content sync send requests from your server to the Anyhour API, including your site's address and, for sync, your API key.

== Installation ==

1. Upload the `anyhour` folder to `/wp-content/plugins/`, or upload `anyhour.zip` under Plugins → Add New → Upload Plugin.
2. Activate the plugin.
3. Go to Settings → Anyhour, enter your AI’s id, tick "Show the chat" and save.
4. Click "Test connection". In Anyhour, make sure your AI is turned on and this website is one of its allowed websites (Install page).

== Frequently Asked Questions ==

= The chat doesn't appear =

Use "Test connection" on the settings page. The chat only loads when your AI is turned on in Anyhour and your site's address is one of its allowed websites. It never shows in the WordPress admin.

= Do I need an API key? =

No. Your AI already reads your website on its own schedule. A key only lets WordPress ask for a re-read sooner after you change content.

= Can I hide the chat on some pages? =

Yes, with a filter in your theme or a small plugin:

`add_filter( 'anyhour_show_chat', function ( $show ) { return is_page( 'checkout' ) ? false : $show; } );`

`anyhour_embed_attributes` changes the script tag's attributes, and `anyhour_sync_delay` changes how long after a change the site is re-read (in seconds).

= My caching or optimisation plugin breaks the chat =

The chat script reads its settings from its own tag, so exclude `embed.js` from JavaScript combining, deferring and delaying.

== Changelog ==

= 0.1.0 =
* First release: settings page, chat embed, connection test and content sync.

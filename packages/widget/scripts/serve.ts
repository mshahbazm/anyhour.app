import { bundle } from "./bundle";

// Local stand-in for the widget CDN: rebuilds both files on every request.
const port = Number(process.env.WIDGET_PORT ?? 3002);

Bun.serve({
  port,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path !== "/embed.js" && path !== "/chat.js")
      return new Response("Not found", { status: 404 });
    try {
      const built = await bundle({ chatFile: "chat.js", minify: true });
      return new Response(path === "/embed.js" ? built.loader : built.chat, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      return new Response(String(error), { status: 500 });
    }
  },
});
console.info(`Anyhour widget on http://localhost:${port}/embed.js`);

// Builds the two files a website loads: embed.js, the small loader every
// page gets, and the full chat it fetches when a visitor opens it.
const root = new URL("../src/embed/", import.meta.url).pathname;

export async function bundle(options: { chatFile: string; minify: boolean }) {
  const define = { "process.env.NODE_ENV": '"production"' };
  const [chat, loader] = await Promise.all(
    [
      { entry: "chat.tsx", define },
      { entry: "loader.ts", define: { ...define, chatFile: JSON.stringify(options.chatFile) } },
    ].map(({ entry, define }) =>
      Bun.build({
        entrypoints: [root + entry],
        target: "browser",
        format: "iife",
        minify: options.minify,
        define,
      }),
    ),
  );
  for (const result of [chat, loader])
    if (!result.success) throw new AggregateError(result.logs, "Widget build failed");
  return { chat: await chat.outputs[0].text(), loader: await loader.outputs[0].text() };
}

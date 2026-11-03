import { bundle } from "./bundle";

// The chat file name carries a hash of its contents, so a CDN can cache it
// forever; only the small embed.js needs a short cache.
const first = await bundle({ chatFile: "chat.js", minify: true });
const hash = new Bun.CryptoHasher("sha256").update(first.chat).digest("hex").slice(0, 10);
const chatFile = `chat-${hash}.js`;
const { chat, loader } = await bundle({ chatFile, minify: true });
const out = new URL("../dist/", import.meta.url).pathname;
await Bun.write(out + chatFile, chat);
await Bun.write(out + "embed.js", loader);
const kb = (text: string) => `${(Bun.gzipSync(text).length / 1024).toFixed(1)} KB gzipped`;
console.info(`embed.js ${kb(loader)} · ${chatFile} ${kb(chat)}`);

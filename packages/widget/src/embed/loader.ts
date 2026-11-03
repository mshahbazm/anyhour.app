import { brandVars } from "../appearance";
import launcherStyles from "./launcher.css" with { type: "text" };
import { launcherButton, teaserView } from "./launcherView";
import { createTracker } from "./tracker";
import { conversationKey, teaserKey } from "./transport";
import type { iChatModule, iWidgetConfig } from "./transport";

// <script src="https://cdn…/embed.js" data-site="CHANNEL_ID" async></script>
// data-site names a website channel, answered by the AI;
// older installs name the AI with data-bot.
//
// This file is all a website loads up front: a few KB, no React. It waits
// until the page has finished loading and the browser is idle, draws the
// closed chat, and fetches the full chat (chat.js) only when a visitor
// shows interest. Page-speed scores never see the chat.

declare const chatFile: string; // Set by the build: the hashed chat bundle.

const script = document.currentScript as HTMLScriptElement | null;
const botId = script?.dataset.site ?? script?.dataset.bot;
const apiOrigin = script?.dataset.api ?? (script ? new URL(script.src).origin : "");
const chatUrl = script ? new URL(chatFile, script.src).href : "";

function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function whenIdle(run: () => void) {
  const idle = () =>
    "requestIdleCallback" in window
      ? requestIdleCallback(run, { timeout: 5000 })
      : setTimeout(run, 1500);
  if (document.readyState === "complete") idle();
  else addEventListener("load", idle, { once: true });
}

let chat: Promise<iChatModule> | undefined;
function loadChat() {
  chat ??= new Promise<iChatModule>((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = chatUrl;
    tag.async = true;
    tag.onload = () => {
      const loaded = (window as { anyhourChat?: iChatModule }).anyhourChat;
      if (loaded) resolve(loaded);
      else reject(new Error("Chat failed to load"));
    };
    tag.onerror = () => {
      chat = undefined; // Let the next click try again.
      reject(new Error("Chat failed to load"));
    };
    document.head.append(tag);
  });
  return chat;
}

async function start(id: string) {
  const base = `${apiOrigin}/api/widget/${encodeURIComponent(id)}`;
  const response = await fetch(`${base}/launcher`, { credentials: "omit" });
  if (!response.ok) return;
  const config = (await response.json()) as iWidgetConfig;
  const pictureUrl = config.pictureUrl ? `${apiOrigin}${config.pictureUrl}` : null;

  const host = document.createElement("div");
  host.id = "anyhour-chat";
  // Shadow DOM keeps the website's CSS and the chat's CSS apart.
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = launcherStyles;
  const closed = document.createElement("div");
  closed.className = "wpEmbed";
  for (const [name, value] of Object.entries(brandVars(config.appearance)))
    closed.style.setProperty(name, value);
  const button = launcherButton(config, pictureUrl);
  closed.append(button);
  shadow.append(style, closed);
  document.body.append(host);
  // Visitor counts, only when the owner turned them on and only what they chose.
  const tracker = Object.values(config.tracking).some(Boolean)
    ? createTracker(apiOrigin, id, config.tracking)
    : null;

  let teaser: HTMLElement | undefined;
  function dismissTeaser() {
    teaser?.remove();
    teaser = undefined;
    try {
      localStorage.setItem(teaserKey(id), "off");
    } catch {
      /* Storage can be blocked; it then shows again next visit. */
    }
  }

  let opening = false;
  async function open(prompt?: string) {
    if (opening) return;
    opening = true;
    dismissTeaser();
    tracker?.chat("open");
    if (prompt) tracker?.chat("prompt");
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
    try {
      const module = await loadChat();
      module.mount({
        shadow,
        config,
        apiOrigin,
        botId: id,
        prompt,
        onEvent: (event) => tracker?.chat(event),
      });
      closed.remove(); // The full chat now draws the same button, open.
    } catch {
      button.classList.remove("is-loading");
      button.removeAttribute("aria-busy");
      opening = false;
    }
  }

  button.addEventListener("click", () => void open());
  // Start fetching the chat as soon as someone reaches for it.
  for (const intent of ["pointerenter", "focusin", "touchstart"])
    closed.addEventListener(intent, () => void loadChat().catch(() => undefined), {
      once: true,
      passive: true,
    });

  // The greeting floats above the closed chat on a first visit only.
  if (stored(teaserKey(id)) !== "off" && !stored(conversationKey(id)))
    setTimeout(() => {
      if (opening) return;
      teaser = teaserView({
        config,
        onOpen: () => void open(),
        onPrompt: (prompt) => void open(prompt),
        onDismiss: dismissTeaser,
      });
      closed.prepend(teaser);
    }, 1200);
}

if (botId && apiOrigin && !document.getElementById("anyhour-chat"))
  whenIdle(() => void start(botId).catch(() => undefined));

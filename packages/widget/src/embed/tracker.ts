import type { iTracking, tChatEvent } from "./transport";

type tEvent = { k: "view"; p: string; r?: string } | { k: tChatEvent };

const limits = { batch: 20, queued: 60, waitMs: 5000, pathLength: 200 };

// Where the visit came from: a campaign tag, else the other site's name.
// Never the full address, which can carry personal details.
function source() {
  const tagged = new URLSearchParams(location.search).get("utm_source");
  if (tagged) return tagged.slice(0, 60).toLowerCase();
  try {
    const host = document.referrer ? new URL(document.referrer).hostname : "";
    return host && host !== location.hostname ? host.replace(/^www\./, "") : undefined;
  } catch {
    return undefined;
  }
}

// Counts visits for the owner's insights, only when they turned visitor
// counts on, and only what they chose: page paths, where visits came from,
// country, device and chat opens. No cookies, stored IDs, or anything personal.
// Events go out in one small beacon when the page is hidden, or after a few
// seconds, never while the website is loading.
export function createTracker(apiOrigin: string, botId: string, tracking: iTracking) {
  const url = `${apiOrigin}/api/widget/${encodeURIComponent(botId)}/collect`;
  const queue: tEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPath = "";

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    while (queue.length) {
      const body = JSON.stringify({
        tz: tracking.location ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
        w: tracking.device ? window.innerWidth : undefined,
        e: queue.splice(0, limits.batch),
      });
      // A beacon survives the page closing and never delays it.
      if (!navigator.sendBeacon?.(url, body))
        void fetch(url, { method: "POST", body, keepalive: true, credentials: "omit" }).catch(
          () => undefined,
        );
    }
  }

  function push(event: tEvent) {
    if (queue.length >= limits.queued) return;
    queue.push(event);
    timer ??= setTimeout(flush, limits.waitMs);
  }

  function view() {
    const path = location.pathname.slice(0, limits.pathLength);
    if (path === lastPath) return;
    // The first page carries the source; empty means a direct visit.
    push(lastPath ? { k: "view", p: path } : { k: "view", p: path, r: source() ?? "" });
    lastPath = path;
  }

  if (tracking.visits) {
    view();
    // Single-page websites change pages without loading a new one.
    const pushState = history.pushState;
    history.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
      pushState.apply(this, args);
      view();
    };
    addEventListener("popstate", view);
  }
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  addEventListener("pagehide", flush);

  return {
    chat(event: tChatEvent) {
      if (tracking.chat) push({ k: event });
    },
  };
}

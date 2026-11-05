import type { iAppearance } from "../appearance";
import type { iBotMessage } from "../botChat";
import type { iBlockAnswer } from "../blocks";

/** What the owner lets the chat count on their website. */
export interface iTracking {
  visits: boolean;
  location: boolean;
  device: boolean;
  chat: boolean;
}

/** Public: everything the closed chat needs, from GET /launcher. */
export interface iWidgetConfig {
  id: string;
  name: string;
  welcomeMessage: string;
  pictureUrl: string | null;
  appearance: iAppearance;
  /** What the chat counts on the website; all off unless the owner turned
   *  visitor counts on. */
  tracking: iTracking;
}

export type tChatEvent = "open" | "prompt";

/** The lazy chat bundle registers this on window for the loader. */
export interface iChatModule {
  mount(options: {
    shadow: ShadowRoot;
    config: iWidgetConfig;
    apiOrigin: string;
    botId: string;
    prompt?: string;
    onEvent: (event: tChatEvent) => void;
  }): void;
}

export const conversationKey = (botId: string) => `anyhour:${botId}:conversation`;
export const teaserKey = (botId: string) => `anyhour:${botId}:teaser`;

interface iStoredConversation {
  id: string;
  resumeToken: string;
}

/** Who is replying in the conversation: the AI, or a person on the team. */
export interface iTeamState {
  handledBy: "agent" | "human";
  waitingForTeam: boolean;
}

/** What the visitor sees while a team member handles the conversation. */
export const teamWillReply = "The team will reply here.";

// Talks to the public widget API from a customer's website.
export function createTransport(apiOrigin: string, botId: string) {
  const base = `${apiOrigin}/api/widget/${encodeURIComponent(botId)}`;
  const storageKey = conversationKey(botId);
  let token: { value: string; expiresAt: number } | null = null;

  async function authorization() {
    if (!token || token.expiresAt < Date.now() + 60_000) {
      const response = await fetch(`${base}/bootstrap`, { method: "POST" });
      if (!response.ok) throw new Error("This chat isn’t available here.");
      const body = (await response.json()) as {
        token: string;
        expiresInSeconds: number;
      };
      token = {
        value: body.token,
        expiresAt: Date.now() + body.expiresInSeconds * 1000,
      };
    }
    return `Bearer ${token.value}`;
  }

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        authorization: await authorization(),
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(body?.error?.message ?? "Something went wrong.");
    }
    return response;
  }

  function stored(): iStoredConversation | null {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      return value && typeof value.id === "string" ? value : null;
    } catch {
      return null;
    }
  }

  async function conversation() {
    const existing = stored();
    if (existing) return existing;
    const response = await request("/conversations", {
      method: "POST",
      body: JSON.stringify({ entryUrl: location.href.slice(0, 2000) }),
    });
    const created = (await response.json()) as iStoredConversation;
    try {
      localStorage.setItem(storageKey, JSON.stringify(created));
    } catch {
      /* Storage can be blocked; the chat still works for this page view. */
    }
    return created;
  }

  return {
    async history(): Promise<{ messages: iBotMessage[]; team: iTeamState | null }> {
      const existing = stored();
      if (!existing) return { messages: [], team: null };
      try {
        const response = await request(`/conversations/${existing.id}`, {
          headers: { "x-conversation-token": existing.resumeToken },
        });
        const body = (await response.json()) as { messages: iBotMessage[] } & Partial<iTeamState>;
        return {
          messages: body.messages.filter((item) => item.role !== "tool"),
          team: {
            handledBy: body.handledBy ?? "agent",
            waitingForTeam: Boolean(body.waitingForTeam),
          },
        };
      } catch {
        localStorage.removeItem(storageKey);
        return { messages: [], team: null };
      }
    },

    /** Team replies since `after` (an ISO time), for the open chat's light poll. */
    async updates(
      after: string | null,
    ): Promise<({ messages: iBotMessage[] } & iTeamState) | null> {
      const existing = stored();
      if (!existing) return null;
      const response = await request(
        `/conversations/${existing.id}/updates${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        { headers: { "x-conversation-token": existing.resumeToken } },
      );
      return (await response.json()) as { messages: iBotMessage[] } & iTeamState;
    },

    /** The visitor opened a WhatsApp button. Fire and forget: keepalive lets it
     *  finish while the page hands over to WhatsApp. */
    whatsappOpened(blockId: string) {
      const existing = stored();
      if (!existing) return;
      void authorization()
        .then((value) =>
          fetch(`${base}/conversations/${existing.id}/whatsapp-open`, {
            method: "POST",
            keepalive: true,
            headers: {
              authorization: value,
              "content-type": "application/json",
              "x-conversation-token": existing.resumeToken,
            },
            body: JSON.stringify({ blockId }),
          }),
        )
        .catch(() => undefined);
    },

    reset() {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    },

    /** Streams the AI's reply; `team` when a person has the conversation instead. */
    async send(
      content: string,
      onDelta: (text: string) => void,
      answer?: iBlockAnswer,
    ): Promise<{ citations: iBotMessage["citations"]; blocks: iBotMessage["blocks"]; team: boolean }> {
      const chat = await conversation();
      const response = await request(`/conversations/${chat.id}/messages`, {
        method: "POST",
        headers: { "x-conversation-token": chat.resumeToken },
        body: JSON.stringify({
          content,
          clientMessageId: crypto.randomUUID(),
          ...answer,
        }),
      });
      if (!response.body) throw new Error("No response.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let citations: iBotMessage["citations"];
      let blocks: iBotMessage["blocks"];
      let team = false;
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
        let split: number;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const event = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim();
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          const payload = JSON.parse(data) as {
            text?: string;
            message?: string;
            citations?: iBotMessage["citations"];
            blocks?: iBotMessage["blocks"];
          };
          if (event === "delta" && payload.text) onDelta(payload.text);
          if (event === "team") team = true;
          if (event === "done") ({ citations, blocks } = payload);
          if (event === "error")
            throw new Error(payload.message ?? "The reply was interrupted.");
        }
        if (done) break;
      }
      return { citations, blocks, team };
    },
  };
}

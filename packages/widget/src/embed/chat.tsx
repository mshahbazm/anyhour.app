import { AssistantModalPrimitive } from "@assistant-ui/react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { brandStyle } from "../appearance";
import { ChatWindow } from "../botChat";
import type { iBotMessage } from "../botChat";
import type { iBlockAnswer } from "../blocks";
import { LauncherButton } from "../launcher";
import { BotRuntimeProvider } from "../runtime";
import chatStyles from "../styles.css" with { type: "text" };
import { createTransport, teamWillReply } from "./transport";
import type { iChatModule, iTeamState, iWidgetConfig, tChatEvent } from "./transport";

// How often an open chat checks for team replies: quickly while a person is
// expected, gently otherwise. Hidden tabs and closed chats don't poll.
const pollWhileTeamMs = 4_000;
const pollQuietMs = 15_000;

/** The newest server time among messages: where the next poll starts. */
function latestTime(messages: iBotMessage[]) {
  return messages.reduce<string | null>(
    (latest, item) => (item.createdAt && (!latest || item.createdAt > latest) ? item.createdAt : latest),
    null,
  );
}

// The full chat, loaded by loader.ts only when a visitor opens it. It takes
// over from the loader's closed button and opens straight away.

function Widget(props: {
  transport: ReturnType<typeof createTransport>;
  config: iWidgetConfig;
  apiOrigin: string;
  prompt?: string;
  mount: HTMLElement;
  onEvent: (event: tChatEvent) => void;
}) {
  const { transport, config } = props;
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<iBotMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [team, setTeam] = useState<iTeamState | null>(null);
  const after = useRef<string | null>(null);
  const appearance = config.appearance;
  const pictureUrl = config.pictureUrl ? `${props.apiOrigin}${config.pictureUrl}` : null;
  const prompted = useRef(false);

  useEffect(() => {
    if (props.prompt && !prompted.current) {
      prompted.current = true;
      void send(props.prompt);
    } else if (!props.prompt)
      void transport.history().then((loaded) => {
        setMessages(loaded.messages);
        setTeam(loaded.team);
        after.current = latestTime(loaded.messages);
      });
    // Runs once, when the chat first opens.
  }, []);

  // Team replies reach the open chat without a reload: a light poll that
  // adds staff messages it hasn't shown yet.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const withTeam = Boolean(team && (team.handledBy === "human" || team.waitingForTeam));
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    async function poll() {
      if (stopped || document.hidden || busyRef.current) return;
      try {
        const update = await transport.updates(after.current);
        if (!update || stopped) return;
        setTeam({ handledBy: update.handledBy, waitingForTeam: update.waitingForTeam });
        if (!update.messages.length) return;
        after.current = latestTime(update.messages) ?? after.current;
        setMessages((items) => [
          ...items,
          ...update.messages.filter((item) => !items.some((known) => known.id === item.id)),
        ]);
      } catch {
        /* A missed poll is retried on the next tick. */
      }
    }
    const timer = window.setInterval(() => void poll(), withTeam ? pollWhileTeamMs : pollQuietMs);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [open, withTeam, transport]);

  async function send(text: string, answer?: iBlockAnswer) {
    const replyId = crypto.randomUUID();
    setError("");
    setBusy(true);
    setMessages((items) => [
      ...items,
      { id: crypto.randomUUID(), role: "visitor", content: text },
      { id: replyId, role: "assistant", content: "" },
    ]);
    try {
      const { citations, blocks, team: withPerson } = await transport.send(
        text,
        (delta) =>
          setMessages((items) =>
            items.map((item) =>
              item.id === replyId ? { ...item, content: item.content + delta } : item,
            ),
          ),
        answer,
      );
      if (withPerson) {
        // A person has the conversation: no AI reply, just the notice.
        setMessages((items) => items.filter((item) => item.id !== replyId));
        setTeam({ handledBy: "human", waitingForTeam: true });
      } else
        setMessages((items) =>
          items.map((item) => (item.id === replyId ? { ...item, citations, blocks } : item)),
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
      setMessages((items) =>
        items.map((item) =>
          item.id === replyId && !item.content ? { ...item, status: "failed" } : item,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <BotRuntimeProvider
      messages={messages}
      busy={busy}
      starterPrompts={
        appearance.whatsapp?.question
          ? [...appearance.starterPrompts, appearance.whatsapp.question]
          : appearance.starterPrompts
      }
      onSend={send}
      onWhatsappOpened={transport.whatsappOpened}
    >
      <AssistantModalPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) props.onEvent("open");
        }}
      >
        <div className="wpEmbed" style={brandStyle(appearance)}>
          <AssistantModalPrimitive.Anchor className="wpEmbedAnchor">
            <AssistantModalPrimitive.Trigger asChild>
              <LauncherButton
                appearance={appearance}
                name={config.name}
                pictureUrl={pictureUrl}
                open={open}
              />
            </AssistantModalPrimitive.Trigger>
          </AssistantModalPrimitive.Anchor>
        </div>
        <AssistantModalPrimitive.Content
          className="wpEmbedPanel"
          side="top"
          align="end"
          sideOffset={14}
          portalProps={{ container: props.mount }}
        >
          <ChatWindow
            variant="live"
            name={config.name}
            avatarUrl={pictureUrl}
            welcomeMessage={config.welcomeMessage}
            appearance={appearance}
            error={error}
            notice={team?.handledBy === "human" ? teamWillReply : undefined}
            onClose={() => setOpen(false)}
            onReset={() => {
              transport.reset();
              setMessages([]);
              setTeam(null);
              after.current = null;
            }}
          />
        </AssistantModalPrimitive.Content>
      </AssistantModalPrimitive.Root>
    </BotRuntimeProvider>
  );
}

const chat: iChatModule = {
  mount({ shadow, config, apiOrigin, botId, prompt, onEvent }) {
    const style = document.createElement("style");
    style.textContent = chatStyles;
    const mount = document.createElement("div");
    shadow.append(style, mount);
    // Drawn synchronously, so the loader's button is swapped in one frame.
    flushSync(() =>
      createRoot(mount).render(
        <Widget
          transport={createTransport(apiOrigin, botId)}
          config={config}
          apiOrigin={apiOrigin}
          prompt={prompt}
          mount={mount}
          onEvent={onEvent}
        />,
      ),
    );
  },
};
(window as { anyhourChat?: iChatModule }).anyhourChat = chat;

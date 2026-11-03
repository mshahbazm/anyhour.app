import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { createContext, useContext } from "react";
import { brandStyle, greeting } from "./appearance";
import type { iAppearance } from "./appearance";
import { Block } from "./blocks";
import type { tChatBlock, tSendMessage } from "./blocks";
import { linkProps, RichText } from "./richText";
import { BotRuntimeProvider } from "./runtime";
import type { iBotCitation, iBotMessage } from "./runtime";

export type { iBotMessage };

interface iChatWindowProps {
  name: string;
  welcomeMessage?: string;
  error?: string;
  disabled?: boolean;
  onReset: () => void;
  /** Shown in the live widget, which can be closed. */
  onClose?: () => void;
  onCitation?: (sourceId: string) => void;
  avatarUrl?: string | null;
  appearance?: iAppearance;
  /** "preview" is the owner's private test; "live" is a visitor on the website. */
  variant?: "preview" | "live";
  /** A calm line above the composer, e.g. while the team is replying. */
  notice?: string;
}

const sparkle = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" />
  </svg>
);

export function BotAvatarImage(props: { url?: string | null; name: string }) {
  return (
    <span className="wpBotAvatar" aria-hidden="true">
      {props.url ? (
        <img src={props.url} alt="" />
      ) : props.name ? (
        props.name.slice(0, 1).toUpperCase()
      ) : (
        sparkle
      )}
    </span>
  );
}

function Citations(props: {
  citations: iBotCitation[];
  onCitation?: (sourceId: string) => void;
}) {
  if (!props.citations.length) return null;
  return (
    <div className="wpBotCitations">
      {props.citations.map((citation) =>
        props.onCitation || !citation.url ? (
          <button
            type="button"
            className="wpBotCitation"
            key={citation.sourceId}
            onClick={() => props.onCitation?.(citation.sourceId)}
          >
            {citation.title || citation.url || "View source"} ↗
          </button>
        ) : (
          <a
            className="wpBotCitation"
            key={citation.sourceId}
            href={citation.url}
            {...linkProps(citation.url)}
          >
            {citation.title || citation.url} ↗
          </a>
        ),
      )}
    </div>
  );
}

function useMessageText() {
  return useAuiState(({ message }) =>
    message.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
  );
}

function UserMessage() {
  const text = useMessageText();
  return (
    <MessagePrimitive.Root className="wpBotMessage wpBotVisitor">
      <div className="wpBotBubble">{text}</div>
    </MessagePrimitive.Root>
  );
}

// The bot's photo sits beside its messages when it has one.
function BotFace(props: { url?: string | null }) {
  return props.url ? <img className="wpBotFace" src={props.url} alt="" /> : null;
}

// Shared with every bot message without recreating message components.
const MessageContext = createContext<{
  avatarUrl?: string | null;
  onCitation?: (sourceId: string) => void;
}>({});

function AssistantMessage() {
  const { avatarUrl, onCitation } = useContext(MessageContext);
  const text = useMessageText();
  const status = useAuiState(({ message }) => message.status?.type);
  const citations = useAuiState(
    ({ message }) =>
      (message.metadata.custom as { citations?: iBotCitation[] }).citations ?? [],
  );
  const staffName = useAuiState(
    ({ message }) => (message.metadata.custom as { staffName?: string | null }).staffName ?? null,
  );
  const blocks = useAuiState(
    ({ message }) => (message.metadata.custom as { blocks?: tChatBlock[] }).blocks ?? [],
  );
  // Only the newest reply's block can be tapped, and not while one is coming.
  const active = useAuiState(({ message, thread }) => message.isLast && !thread.isRunning);
  // A person from the team: their initial and first name, not the bot's face.
  if (staffName)
    return (
      <MessagePrimitive.Root className="wpBotMessage hasFace wpBotStaff">
        <span className="wpBotFace wpBotStaffFace" aria-hidden="true">
          {staffName.slice(0, 1).toUpperCase()}
        </span>
        <span className="wpBotStaffName">{staffName}</span>
        <div className="wpBotBubble">
          <RichText text={text} />
        </div>
      </MessagePrimitive.Root>
    );
  return (
    <MessagePrimitive.Root className={`wpBotMessage ${avatarUrl ? "hasFace" : ""}`}>
      <BotFace url={avatarUrl} />
      {(text || !blocks.length) && <div className="wpBotBubble">
        {text ? (
          <RichText text={text} />
        ) : status === "running" ? (
          <span className="wpBotTyping" role="status" aria-label="Typing">
            <i />
            <i />
            <i />
          </span>
        ) : (
          "Response interrupted."
        )}
      </div>}
      {blocks.map((block) => (
        <Block key={block.id} block={block} active={active} />
      ))}
      {status === "incomplete" && text && (
        <small>Response interrupted. You can send a new message.</small>
      )}
      <Citations citations={citations} onCitation={onCitation} />
    </MessagePrimitive.Root>
  );
}

// The chat itself, built on assistant-ui primitives. Needs a BotRuntimeProvider.
export function ChatWindow(props: iChatWindowProps) {
  const live = props.variant === "live";
  const prompts = props.appearance?.starterPrompts ?? [];
  const running = useAuiState(({ thread }) => thread.isRunning);
  return (
    <ThreadPrimitive.Root
      className={`wpBot ${live ? "wpBotLive" : ""}`}
      style={brandStyle(props.appearance)}
      aria-label={live ? `Chat with ${props.name}` : "Customer bot preview"}
    >
      <header className="wpBotHeader">
        <BotAvatarImage url={props.avatarUrl} name={props.name} />
        <div>
          <strong>{props.name}</strong>
          <span>Usually replies instantly</span>
        </div>
        <button
          type="button"
          onClick={props.onReset}
          disabled={running}
          aria-label={live ? "Start a new conversation" : "Start a fresh test"}
          title="Start over"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M3 10a9 9 0 1 1 2 9M3 4v6h6" />
          </svg>
        </button>
        {props.onClose && (
          <button type="button" onClick={props.onClose} aria-label="Close chat" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </header>

      <ThreadPrimitive.Viewport className="wpBotMessages" role="log" aria-label="Conversation">
        <div className={`wpBotMessage ${props.avatarUrl ? "hasFace" : ""}`}>
          <BotFace url={props.avatarUrl} />
          <div className="wpBotBubble">{greeting(props.name, props.welcomeMessage)}</div>
        </div>
        <MessageContext.Provider
          value={{ avatarUrl: props.avatarUrl, onCitation: props.onCitation }}
        >
          <ThreadPrimitive.Messages
          components={{ UserMessage, AssistantMessage }}
          />
        </MessageContext.Provider>
        {prompts.length > 0 && (
          <ThreadPrimitive.Empty>
            <div className="wpBotStarters">
              {prompts.map((prompt) => (
                <ThreadPrimitive.Suggestion
                  key={prompt}
                  prompt={prompt}
                  send
                  className="wpBotStarter"
                >
                  {prompt}
                </ThreadPrimitive.Suggestion>
              ))}
            </div>
          </ThreadPrimitive.Empty>
        )}
      </ThreadPrimitive.Viewport>

      {props.error && (
        <p className="wpBotError" role="alert">
          {props.error}
        </p>
      )}
      {props.notice && !props.error && (
        <p className="wpBotNotice" role="status">
          {props.notice}
        </p>
      )}
      <ComposerPrimitive.Root className="wpBotComposer">
        <ComposerPrimitive.Input
          aria-label={`Message ${props.name}`}
          placeholder={props.disabled ? "Waiting for knowledge…" : `Message ${props.name}…`}
          maxLength={4000}
          rows={1}
        />
        <ComposerPrimitive.Send aria-label="Send message">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
            <path d="M12 19V5m-6 6 6-6 6 6" />
          </svg>
        </ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
      <p className="wpBotFooter">AI assistant · may make mistakes</p>
    </ThreadPrimitive.Root>
  );
}

interface iBotChatProps extends iChatWindowProps {
  messages: iBotMessage[];
  busy: boolean;
  onSend: tSendMessage;
}

// A self-contained chat: runtime plus window. Used for the owner's test chat.
export function BotChat(props: iBotChatProps) {
  return (
    <BotRuntimeProvider
      messages={props.messages}
      busy={props.busy}
      disabled={props.disabled}
      onSend={props.onSend}
    >
      <ChatWindow {...props} />
    </BotRuntimeProvider>
  );
}

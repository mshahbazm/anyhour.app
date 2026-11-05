import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import type { AppendMessage, ThreadMessageLike } from "@assistant-ui/react";
import type { ReactNode } from "react";
import { SendContext, WhatsappOpenedContext } from "./blocks";
import type { tChatBlock, tSendMessage, tWhatsappOpened } from "./blocks";

export interface iBotCitation {
  sourceId: string;
  title: string | null;
  url: string | null;
}

export interface iBotMessage {
  id: string;
  role: string;
  content: string;
  status?: string;
  citations?: iBotCitation[];
  /** The AI's tappable block under its reply (at most one). */
  blocks?: tChatBlock[];
  /** A team member's reply: their first name. */
  staffName?: string;
  createdAt?: string;
}

function convert(message: iBotMessage): ThreadMessageLike {
  const visitor = message.role === "visitor";
  return {
    id: message.id,
    role: visitor ? "user" : "assistant",
    content: [{ type: "text", text: message.content }],
    // Otherwise assistant-ui works out "running" from isRunning.
    ...(!visitor && message.status === "failed"
      ? { status: { type: "incomplete", reason: "error" } as const }
      : {}),
    metadata: {
      custom: {
        citations: message.citations ?? [],
        staffName: message.staffName ?? null,
        blocks: message.blocks ?? [],
      },
    },
  };
}

function textOf(message: AppendMessage) {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

const noop = () => undefined;

// Our own transport keeps the messages; assistant-ui only renders them.
export function BotRuntimeProvider(props: {
  messages: iBotMessage[];
  busy: boolean;
  disabled?: boolean;
  starterPrompts?: string[];
  /** Typed messages, and taps or the contact form on a block (with `answer`). */
  onSend: tSendMessage;
  /** A visitor opened a WhatsApp button; the dashboard preview can leave it out. */
  onWhatsappOpened?: tWhatsappOpened;
  children: ReactNode;
}) {
  const runtime = useExternalStoreRuntime({
    messages: props.messages.filter((message) => message.role !== "tool"),
    convertMessage: convert,
    isRunning: props.busy,
    isDisabled: props.disabled,
    suggestions: (props.starterPrompts ?? []).map((prompt) => ({ prompt })),
    onNew: async (message) => {
      const text = textOf(message);
      if (text) await props.onSend(text);
    },
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SendContext.Provider value={props.onSend}>
        <WhatsappOpenedContext.Provider value={props.onWhatsappOpened ?? noop}>
          {props.children}
        </WhatsappOpenedContext.Provider>
      </SendContext.Provider>
    </AssistantRuntimeProvider>
  );
}

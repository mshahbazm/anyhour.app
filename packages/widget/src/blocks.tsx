import { createContext, useContext, useState } from "react";
import type { FormEvent } from "react";
import { WhatsappIcon } from "./icons";

// The AI's chat UI blocks under a reply: quick replies, an option
// list, a checklist, a short contact form and the WhatsApp button.
// Mirrors the API's stored block (chatBlock.schema.ts); this package
// doesn't import the API.

export interface iBlockOption {
  label: string;
  value: string;
  description?: string;
}

export type tChatBlock = { id: string; fallback: string } & (
  | { kind: "choices"; options: iBlockOption[] }
  | { kind: "list"; buttonLabel: string; options: iBlockOption[] }
  | { kind: "checklist"; title: string; items: Array<{ text: string; done: boolean }> }
  | { kind: "contactForm"; ask: "email" | "phone" | "emailOrPhone"; askName: boolean; topic: string }
  | { kind: "whatsapp"; label: string; url: string }
);

/** A tap or the contact form, sent with the visitor's message. */
export interface iBlockAnswer {
  blockReply: { blockId: string; value: string };
  contact?: { name?: string; email?: string; phone?: string };
}

export type tSendMessage = (text: string, answer?: iBlockAnswer) => Promise<void> | void;

export const SendContext = createContext<tSendMessage>(() => undefined);

/** A visitor opened the WhatsApp button; never blocks the navigation. */
export type tWhatsappOpened = (blockId: string) => void;

export const WhatsappOpenedContext = createContext<tWhatsappOpened>(() => undefined);

// Stays a working link on older replies too: the number doesn't expire.
function WhatsappButton(props: { block: Extract<tChatBlock, { kind: "whatsapp" }> }) {
  const opened = useContext(WhatsappOpenedContext);
  const { block } = props;
  return (
    <div className="wpBlock">
      <a
        className="wpBlockWhatsapp"
        href={block.url}
        target="_blank"
        rel="noopener"
        onClick={() => opened(block.id)}
      >
        <WhatsappIcon size={18} />
        {block.label}
      </a>
    </div>
  );
}

function ContactForm(props: { block: Extract<tChatBlock, { kind: "contactForm" }>; active: boolean }) {
  const send = useContext(SendContext);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState("");
  const { block } = props;
  const asks = block.ask === "emailOrPhone" ? (["email", "phone"] as const) : [block.ask];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const read = (key: string) => String(data.get(key) ?? "").trim() || undefined;
    const contact = { name: read("name"), email: read("email"), phone: read("phone") };
    if (!contact.email && !contact.phone) return setProblem("Add an email or phone number.");
    // The same check as the server: international format.
    if (contact.phone && !/^\+[1-9]\d{7,14}$/.test(contact.phone.replace(/[\s().-]/g, "")))
      return setProblem("Add your phone number with the country code, like +44.");
    setProblem("");
    setSent(true);
    void send(
      [contact.name, contact.email, contact.phone].filter(Boolean).join(" · "),
      { blockReply: { blockId: block.id, value: "sent" }, contact },
    );
  }
  const off = !props.active || sent;
  return (
    <form className="wpBlock wpBlockForm" onSubmit={submit}>
      <span>{block.fallback}</span>
      {block.askName && (
        <input name="name" aria-label="Your name" placeholder="Your name" autoComplete="name" maxLength={120} disabled={off} />
      )}
      {asks.includes("email") && (
        <input
          name="email"
          type="email"
          aria-label="Email"
          placeholder="Email"
          autoComplete="email"
          maxLength={254}
          required={block.ask === "email"}
          disabled={off}
        />
      )}
      {asks.includes("phone") && (
        <input
          name="phone"
          type="tel"
          aria-label="Phone"
          placeholder="Phone, e.g. +44 7700 900123"
          autoComplete="tel"
          maxLength={32}
          required={block.ask === "phone"}
          disabled={off}
        />
      )}
      {problem && <small role="alert">{problem}</small>}
      <button type="submit" className="wpBlockButton" disabled={off}>
        {sent ? "Sent" : "Send"}
      </button>
    </form>
  );
}

/** One block. `active` only on the newest reply while nothing is running. */
export function Block(props: { block: tChatBlock; active: boolean }) {
  const send = useContext(SendContext);
  const { block, active } = props;
  const tap = (label: string, value: string) =>
    void send(label, { blockReply: { blockId: block.id, value } });
  if (block.kind === "choices" || block.kind === "list")
    return (
      <div className={`wpBlock ${block.kind === "list" ? "wpBlockList" : "wpBlockChoices"}`}>
        {block.options.map((option) => (
          <button
            type="button"
            className="wpBlockButton"
            key={option.value}
            disabled={!active}
            onClick={() => tap(option.label, option.value)}
          >
            {option.label}
            {option.description && <small>{option.description}</small>}
          </button>
        ))}
      </div>
    );
  if (block.kind === "checklist")
    return (
      <div className="wpBlock wpBlockChecklist">
        <strong>{block.title}</strong>
        <ul>
          {block.items.map((item) => (
            <li key={item.text} className={item.done ? "isDone" : ""}>
              {item.text}
            </li>
          ))}
        </ul>
      </div>
    );
  if (block.kind === "whatsapp") return <WhatsappButton block={block} />;
  return <ContactForm block={block} active={active} />;
}

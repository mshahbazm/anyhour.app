import type { ReactNode } from "react";

const linkPattern =
  /\[([^\]\n]{1,200})\]\(<?((?:https?:\/\/|mailto:|tel:)[^\s)>]+)>?\)|((?:https?:\/\/)[^\s<>()]+[^\s<>().,!?;:'"])/g;

function safeHref(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

// Pages on the site the chat is on open in place, so the bot can walk a
// visitor around; anything else opens in a new tab and keeps the chat.
export function linkProps(href: string) {
  let sameSite = false;
  try {
    sameSite = new URL(href).host === window.location.host;
  } catch {
    sameSite = false;
  }
  return sameSite
    ? { target: "_top" }
    : { target: "_blank", rel: "noopener noreferrer" };
}

// Renders bot replies with clickable links and **bold**, without trusting HTML.
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index}>{inline(paragraph)}</p>
      ))}
    </>
  );
}

function inline(text: string) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(linkPattern)) {
    const start = match.index;
    if (start > last) parts.push(...bold(text.slice(last, start), parts.length));
    const href = safeHref(match[2] ?? match[3]);
    const label = match[1] ?? match[3];
    parts.push(
      href ? (
        <a key={parts.length} href={href} {...linkProps(href)}>
          {label}
        </a>
      ) : (
        label
      ),
    );
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(...bold(text.slice(last), parts.length));
  return parts;
}

function bold(text: string, offset: number) {
  return text
    .split(/\*\*([^*]+)\*\*/g)
    .map((part, index) =>
      index % 2 ? <strong key={`${offset}-${index}`}>{part}</strong> : part,
    );
}

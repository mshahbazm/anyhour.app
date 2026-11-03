import type { CSSProperties } from "react";
import type { tLauncherIcon } from "./iconPaths";

export type tLauncherStyle = "avatar" | "icon" | "label";

export interface iAppearance {
  brandColor: string | null;
  launcher: tLauncherStyle;
  /** Icon on the chat button for the "icon" and "label" styles. */
  launcherIcon?: tLauncherIcon;
  /** Text on the "label" button. Empty uses "Chat with {name}". */
  launcherLabel?: string;
  starterPrompts: string[];
}

export const defaultAppearance: iAppearance = {
  brandColor: null,
  launcher: "avatar",
  launcherIcon: "chat",
  starterPrompts: [],
};

const neutral = "#171717";

// Text on the brand colour stays readable whatever colour the owner picks.
function readableOn(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [value >> 16, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? "#171717" : "#ffffff";
}

export function brandVars(appearance: iAppearance | undefined) {
  const brand = /^#[0-9a-f]{6}$/i.test(appearance?.brandColor ?? "")
    ? (appearance?.brandColor as string)
    : neutral;
  return { "--wp-brand": brand, "--wp-on-brand": readableOn(brand) };
}

export function brandStyle(appearance: iAppearance | undefined): CSSProperties {
  return brandVars(appearance) as CSSProperties;
}

export const launcherLabelLength = 24;

export function launcherLabel(appearance: iAppearance, name: string) {
  return appearance.launcherLabel?.trim() || `Chat with ${name}`;
}

// Mirrors packages/api/src/services/chat/greeting.ts: an untouched default
// introduces the bot by name.
export function greeting(name: string, welcomeMessage: string | undefined) {
  const message = welcomeMessage?.trim() ?? "";
  return !message || message === "How can I help?"
    ? `Hi, I’m ${name} 👋 How can I help?`
    : message;
}

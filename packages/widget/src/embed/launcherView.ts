import { greeting, launcherLabel } from "../appearance";
import { launcherIcons } from "../iconPaths";
import type { tLauncherIcon } from "../iconPaths";
import type { iWidgetConfig } from "./transport";

// The closed chat drawn without React, matching LauncherButton and Teaser in
// ../launcher.tsx class for class. Owner text is only ever set as text.

const svgNs = "http://www.w3.org/2000/svg";

function icon(id: string | undefined, size: number) {
  const svg = document.createElementNS(svgNs, "svg");
  const attributes = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.8,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  };
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, String(value));
  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", (launcherIcons[id as tLauncherIcon] ?? launcherIcons.chat).path);
  svg.append(path);
  return svg;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function launcherButton(config: iWidgetConfig, pictureUrl: string | null) {
  const appearance = config.appearance;
  const button = element("button", `wpEmbedLauncher is-${appearance.launcher}`);
  button.type = "button";
  button.setAttribute("aria-label", `Chat with ${config.name}`);
  if (appearance.launcher === "avatar") {
    const avatar = element("span", "wpBotAvatar");
    avatar.setAttribute("aria-hidden", "true");
    if (pictureUrl) {
      const image = element("img", "");
      image.src = pictureUrl;
      image.alt = "";
      avatar.append(image);
    } else avatar.textContent = config.name.slice(0, 1).toUpperCase();
    button.append(avatar);
  } else if (appearance.launcher === "label") {
    button.append(
      icon(appearance.launcherIcon, 22),
      element("span", "", launcherLabel(appearance, config.name)),
    );
  } else button.append(icon(appearance.launcherIcon, 24));
  return button;
}

export function teaserView(props: {
  config: iWidgetConfig;
  onOpen: () => void;
  onPrompt: (prompt: string) => void;
  onDismiss: () => void;
}) {
  const { config } = props;
  const root = element("div", "wpTeaser");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", `Message from ${config.name}`);
  const close = element("button", "wpTeaserClose", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss");
  close.onclick = props.onDismiss;
  const bubble = element("button", "wpTeaserBubble", greeting(config.name, config.welcomeMessage));
  bubble.type = "button";
  bubble.onclick = props.onOpen;
  root.append(close, bubble);
  for (const prompt of config.appearance.starterPrompts) {
    const chip = element("button", "wpTeaserPrompt", prompt);
    chip.type = "button";
    chip.onclick = () => props.onPrompt(prompt);
    root.append(chip);
  }
  return root;
}

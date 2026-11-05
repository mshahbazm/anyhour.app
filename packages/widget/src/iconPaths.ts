// Icons an owner can pick for the closed chat button. Plain data, so the
// embed loader can draw them without React.
export const launcherIcons = {
  chat: {
    label: "Chat",
    path: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z",
  },
  dots: {
    label: "Typing",
    path: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12ZM8.5 12h.01M12 12h.01M15.5 12h.01",
  },
  smile: {
    label: "Smile",
    path: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12ZM9 13.5a4 4 0 0 0 6 0M9.5 10h.01M14.5 10h.01",
  },
  help: {
    label: "Question",
    path: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.6 9.2a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2.2-2.4 3.5M12 17h.01",
  },
  headset: {
    label: "Support",
    path: "M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2v1Zm16 0a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2v1Zm-3 2v1a3 3 0 0 1-3 3h-2",
  },
  sparkle: {
    label: "Sparkle",
    path: "m12 3 2.3 5.7L20 11l-5.7 2.3L12 19l-2.3-5.7L4 11l5.7-2.3L12 3Z",
  },
  wave: {
    label: "Wave",
    path: "M8 13V6.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V13a7 7 0 0 1-7 7h-.5a6.5 6.5 0 0 1-5.2-2.6L3.6 15a1.6 1.6 0 0 1 2.5-2l1.9 2",
  },
  mail: {
    label: "Message",
    path: "M4 6h16v12H4zM4 7l8 6 8-6",
  },
} as const;

export type tLauncherIcon = keyof typeof launcherIcons;

/** The WhatsApp glyph on the WhatsApp question and the WhatsApp button. */
export const whatsappIcon = {
  label: "WhatsApp",
  path: "M7.9 20A9 9 0 1 0 4 16.1L2 22ZM9 9.4c0 3 2.6 5.6 5.6 5.6l.9-1.5-1.9-1-.9.8a4.2 4.2 0 0 1-2-2l.8-.9-1-1.9Z",
} as const;
export const launcherIconIds = Object.keys(launcherIcons) as tLauncherIcon[];


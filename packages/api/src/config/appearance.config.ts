// How the chat looks on the owner's website. Kept small on purpose: a brand
// colour, how the closed chat appears, and a few starter questions.
export const launcherStyles = ['avatar', 'icon', 'label'] as const
export type tLauncherStyle = (typeof launcherStyles)[number]

// Mirrors packages/widget/src/icons.tsx.
export const launcherIcons = [
  'chat',
  'dots',
  'smile',
  'help',
  'headset',
  'sparkle',
  'wave',
  'mail',
] as const

export const appearanceLimits = {
  starterPrompts: 4,
  starterPromptLength: 80,
  launcherLabelLength: 24,
} as const

export interface iAppearance {
  /** Hex colour, e.g. "#2563eb". Null uses the neutral default. */
  brandColor: string | null
  launcher: tLauncherStyle
  launcherIcon?: (typeof launcherIcons)[number]
  /** Text on the "label" button. Empty uses "Chat with {name}". */
  launcherLabel?: string
  /** Shown before a visitor's first message, then never again. */
  starterPrompts: string[]
}

export const defaultAppearance: iAppearance = {
  brandColor: null,
  launcher: 'avatar',
  launcherIcon: 'chat',
  starterPrompts: [],
}

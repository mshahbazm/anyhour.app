// Bot profile pictures: photorealistic portraits of fictional people.
export const botPictureConfig = {
  size: '1024x1024',
  quality: 'medium',
  format: 'webp',
  compression: 82,
  timeoutMs: 90_000,
  maxDescriptionLength: 400,
} as const

// Saved prompts. The client shows the labels; prompts stay on the server.
export const botPictureStyles = {
  friendly: {
    label: 'Friendly professional',
    prompt:
      'a warm, approachable customer-care professional smiling naturally at the camera, soft diffused studio light, plain light-grey backdrop',
  },
  industry: {
    label: 'Fits my business',
    prompt:
      'a person who clearly works in this business, dressed and placed in a setting typical for it, background softly blurred',
  },
  studio: {
    label: 'Studio editorial',
    prompt:
      'an editorial studio headshot, seamless warm-neutral backdrop, gentle key light with soft rim light, calm confident expression',
  },
  outdoor: {
    label: 'Natural light',
    prompt:
      'a candid outdoor portrait in late-afternoon natural light, relaxed genuine smile, greenery or street softly out of focus',
  },
  corporate: {
    label: 'Corporate',
    prompt:
      'a polished corporate headshot in smart business attire, modern bright office background heavily blurred',
  },
  creative: {
    label: 'Creative casual',
    prompt:
      'a stylish, casually dressed person in front of a softly coloured backdrop, contemporary and friendly',
  },
} as const
export type tBotPictureStyle = keyof typeof botPictureStyles
export const botPictureStyleIds = Object.keys(botPictureStyles) as [
  tBotPictureStyle,
  ...tBotPictureStyle[],
]

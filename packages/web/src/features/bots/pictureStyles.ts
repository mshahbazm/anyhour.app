// Mirrors the ids in packages/api/src/config/botPicture.config.ts; prompts stay server-side.
export const pictureStyles = [
  { id: 'industry', label: 'Fits my business' },
  { id: 'friendly', label: 'Friendly professional' },
  { id: 'studio', label: 'Studio editorial' },
  { id: 'outdoor', label: 'Natural light' },
  { id: 'corporate', label: 'Corporate' },
  { id: 'creative', label: 'Creative casual' },
] as const
export type tPictureStyle = (typeof pictureStyles)[number]['id']

import type { tWorkspaceView } from './types'

// Every page has its own address, so links, reloads and the browser's back
// button all land where the owner expects. This month's numbers are the
// front page is the AI's chat; it and Profile sit under the AI's header.
export const viewPaths = {
  assistant: '/',
  profile: '/profile',
  rules: '/rules',
  business: '/business',
  channels: '/channels',
  conversations: '/conversations',
  leads: '/leads',
  contacts: '/contacts',
} as const satisfies Record<tWorkspaceView, string>

/** The AI's own pages, under its header and tabs. */
export const aiViews = ['assistant', 'profile'] as const
export type tAiView = (typeof aiViews)[number]

export function isAiView(view: tWorkspaceView): view is tAiView {
  return (aiViews as readonly string[]).includes(view)
}

export function viewFromPath(pathname: string): tWorkspaceView {
  const segment = pathname.split('/').at(1) ?? ''
  const match = Object.entries(viewPaths).find(
    ([, path]) => path === `/${segment}`,
  )
  return match ? (match[0] as tWorkspaceView) : 'assistant'
}

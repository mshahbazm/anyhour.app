import { api } from '../workspace/api'
import type { iAssistant } from '../workspace/types'

/** What visitor counts count, said wherever they are turned on. */
export const visitorCountsLine = 'Counts visits and visitors. No cookies.'

// Mirrors packages/api/src/config/tracking.config.ts.
export const trackingOptions = ['visits', 'location', 'device', 'chat'] as const
export type tTrackingOption = (typeof trackingOptions)[number]
export type tTracking = Record<tTrackingOption, boolean>

export const defaultTracking: tTracking = {
  visits: true,
  location: true,
  device: true,
  chat: true,
}

export const trackingRows: Array<{
  key: tTrackingOption
  title: string
  detail: string
}> = [
  {
    key: 'visits',
    title: 'Visits and pages',
    detail:
      'How many people visit, which pages they see, and the site that sent them.',
  },
  {
    key: 'location',
    title: 'Country',
    detail: 'From the visitor’s network or time zone. Never a city or address.',
  },
  {
    key: 'device',
    title: 'Device and browser',
    detail: 'Phone, tablet or computer, and which browser.',
  },
  {
    key: 'chat',
    title: 'Chat opens',
    detail: 'How many open the chat or tap a suggested question.',
  },
]

/** What is counted on the website: the owner's choices while visitor
 *  counts are on, nothing while they're off. */
export function countedTracking(bot: iAssistant | undefined): tTracking {
  const on = bot?.tracking ?? false
  const options = { ...defaultTracking, ...bot?.trackingOptions }
  return {
    visits: on && options.visits,
    location: on && options.location,
    device: on && options.device,
    chat: on && options.chat,
  }
}

function patch(organizationId: string, botId: string, body: object) {
  return api<iAssistant>(
    `/api/organizations/${organizationId}/assistants/${botId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  )
}

/** Turns website insights (assistant.tracking) on or off. */
export function saveTracking(
  organizationId: string,
  botId: string,
  tracking: boolean,
) {
  return patch(organizationId, botId, { tracking })
}

/** Chooses what visitor counts count (assistant.trackingOptions). */
export function saveTrackingOptions(
  organizationId: string,
  botId: string,
  options: tTracking,
) {
  return patch(organizationId, botId, { trackingOptions: options })
}

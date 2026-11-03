// Website insights: what the chat counts on the owner's website when they
// turn visitor counts on (`assistant.tracking`, off by default). Under that
// switch the owner chooses what is counted (`assistant.trackingOptions`, all
// on by default). Daily totals only: no cookies, nothing that identifies a
// visitor, no full addresses.
export const trackingOptions = ['visits', 'location', 'device', 'chat'] as const
export type tTrackingOption = (typeof trackingOptions)[number]
export type tTracking = Record<tTrackingOption, boolean>

export const defaultTracking: tTracking = {
  /** Page views, unique visitors, top pages, where visits came from. */
  visits: true,
  /** Country, from the visitor's network or time zone. Never the address. */
  location: true,
  /** Phone, tablet or computer, and browser. */
  device: true,
  /** Chat opens and suggested-question taps. */
  chat: true,
}

export const insightsLimits = {
  /** Distinct pages or sources kept per day; the rest count as "Other". */
  valuesPerDay: 300,
  /** Events accepted in one beacon. */
  eventsPerBeacon: 20,
  beaconBytes: 4096,
  /** Beacons one visitor can send per minute. */
  beaconsPerMinute: 30,
  /** Per server process: visitors held between flushes, and beacons a
   *  minute across all websites. Past this, beacons are dropped, which
   *  bounds memory and work even under a flood from many addresses. */
  pendingVisitors: 50_000,
  beaconsPerMinuteTotal: 120_000,
  /** Daily totals are tiny, so they're kept for over a year. */
  keepDays: 400,
  /** Visitor fingerprints only exist to count a day's unique visitors. */
  keepVisitorDays: 2,
  /** Collected counts are written in one batch this often. */
  flushSeconds: 15,
  rangeDays: [7, 30, 90] as const,
} as const

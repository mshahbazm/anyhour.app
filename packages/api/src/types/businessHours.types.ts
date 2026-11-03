// A business's opening hours (docs/glossary.md, "Opening hours"): read from
// Your business, never typed into a form. Times are local to the
// workspace's time zone.

/** One stretch of opening time, 'HH:MM' to 'HH:MM' (24-hour clock). */
export interface iOpeningRange {
  opens: string
  closes: string
}

/** One day's opening times; empty when closed. */
export type tDayHours = iOpeningRange[]

/** Seven days, Monday first. */
export type tBusinessHours = tDayHours[]

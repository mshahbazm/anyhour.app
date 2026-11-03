import { and, count, eq, gte, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { conversation, lead, siteStatDaily } from '../../db/schema'

const totals = ['visitors', 'views', 'opens', 'prompts'] as const
const breakdowns = ['page', 'source', 'country', 'device', 'browser'] as const
const topPerBreakdown = 8

type tTotals = Record<
  (typeof totals)[number] | 'conversations' | 'leads',
  number
>

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10)
}

function emptyTotals(): tTotals {
  return {
    visitors: 0,
    views: 0,
    opens: 0,
    prompts: 0,
    conversations: 0,
    leads: 0,
  }
}

// The website over the last `days` days, with the period before it for
// comparison. Visits come from the daily counts; website conversations and
// leads from the AI's own records, so they're there even with tracking off.
export async function siteInsights(assistantId: string, days: number) {
  const dayMs = 86_400_000
  const today = new Date(`${isoDay(new Date())}T00:00:00Z`)
  const start = new Date(today.getTime() - (days - 1) * dayMs)
  const previousStart = new Date(start.getTime() - days * dayMs)

  const [stats, chats, leads, top, ever] = await Promise.all([
    db
      .select({
        day: siteStatDaily.day,
        metric: siteStatDaily.metric,
        count: siteStatDaily.count,
      })
      .from(siteStatDaily)
      .where(
        and(
          eq(siteStatDaily.assistantId, assistantId),
          eq(siteStatDaily.value, ''),
          gte(siteStatDaily.day, isoDay(previousStart)),
        ),
      ),
    db
      .select({
        day: sql<string>`to_char(${conversation.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        count: count(),
      })
      .from(conversation)
      .where(
        and(
          eq(conversation.assistantId, assistantId),
          eq(conversation.channel, 'widget'),
          eq(conversation.isTest, false),
          gte(conversation.createdAt, previousStart),
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        day: sql<string>`to_char(${lead.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        count: count(),
      })
      .from(lead)
      .where(
        and(
          eq(lead.assistantId, assistantId),
          isNull(lead.mergedIntoLeadId),
          gte(lead.createdAt, previousStart),
        ),
      )
      .groupBy(sql`1`),
    db.execute<{ metric: string; value: string; total: number }>(sql`
      select metric, value, total::int as total from (
        select metric, value, sum(count) as total,
          row_number() over (partition by metric order by sum(count) desc) as rank
        from ${siteStatDaily}
        where assistant_id = ${assistantId} and value <> ''
          and day >= ${isoDay(start)}
        group by metric, value
      ) ranked
      where rank <= ${topPerBreakdown}
      order by metric, total desc`),
    db
      .select({ day: siteStatDaily.day })
      .from(siteStatDaily)
      .where(eq(siteStatDaily.assistantId, assistantId))
      .limit(1),
  ])

  const daily = Array.from({ length: days }, (_, index) => ({
    day: isoDay(new Date(start.getTime() + index * dayMs)),
    ...emptyTotals(),
  }))
  const byDay = new Map(daily.map((row) => [row.day, row]))
  const current = emptyTotals()
  const previous = emptyTotals()
  const tally = (day: string, metric: keyof tTotals, value: number) => {
    const target = day >= isoDay(start) ? current : previous
    target[metric] += value
    const row = byDay.get(day)
    if (row) row[metric] += value
  }
  for (const row of stats)
    if ((totals as readonly string[]).includes(row.metric))
      tally(row.day, row.metric as (typeof totals)[number], row.count)
  for (const row of chats) tally(row.day, 'conversations', row.count)
  for (const row of leads) tally(row.day, 'leads', row.count)

  const breakdown = Object.fromEntries(
    breakdowns.map((metric) => [
      metric,
      top.rows
        .filter((row) => row.metric === metric)
        .map((row) => ({ value: row.value, count: Number(row.total) })),
    ]),
  ) as Record<
    (typeof breakdowns)[number],
    Array<{ value: string; count: number }>
  >

  return {
    days,
    hasVisits: ever.length > 0,
    totals: current,
    previous,
    daily,
    top: breakdown,
  }
}

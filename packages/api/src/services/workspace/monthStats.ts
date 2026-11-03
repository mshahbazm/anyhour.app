import { and, count, eq, exists, gte, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  assistant,
  conversation,
  knowledgeSource,
  lead,
  message,
  organization,
  siteStatDaily,
} from '../../db/schema'
import { findWorkspaceAi } from '../assistants/workspaceAi'
import { countedTracking } from '../insights/collect'
import type { iMonthStats } from '../../types/stats.types'
import { outsideHoursSql } from './businessHours'

// The month so far: from the first day, 00:00 UTC.
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export async function monthStats(
  organizationId: string,
  now = new Date(),
): Promise<iMonthStats> {
  const since = monthStart(now)
  const workspaceAi = db
    .select({ id: assistant.id })
    .from(assistant)
    .where(eq(assistant.organizationId, organizationId))
  // The website funnel's first two steps. Visitor counts are the AI's
  // website insights, while they're on and counting visits.
  const ai = await findWorkspaceAi(organizationId)
  const funnel = Promise.all([
    db
      .select({
        total: sql<number>`coalesce(sum(${siteStatDaily.count}), 0)::int`,
      })
      .from(siteStatDaily)
      .where(
        and(
          eq(siteStatDaily.assistantId, ai?.id ?? ''),
          eq(siteStatDaily.metric, 'visitors'),
          eq(siteStatDaily.value, ''),
          gte(siteStatDaily.day, since.toISOString().slice(0, 10)),
        ),
      ),
    db
      .select({ total: count() })
      .from(conversation)
      .where(
        and(
          inArray(conversation.assistantId, workspaceAi),
          eq(conversation.channel, 'widget'),
          eq(conversation.isTest, false),
          gte(conversation.createdAt, since),
        ),
      ),
  ])
  // Outside the opening hours read from Your business, in the workspace's
  // time zone; 08:00–18:00 weekdays until they're found.
  const [workspace] = await db
    .select({
      timeZone: organization.timeZone,
      businessHours: organization.businessHours,
    })
    .from(organization)
    .where(eq(organization.id, organizationId))
  const outside = outsideHoursSql(
    conversation.createdAt,
    workspace?.businessHours ?? null,
    workspace?.timeZone ?? null,
  )
  const [answered, handedOff, caught, won, learned] = await Promise.all([
    db
      .select({
        total: count(),
        outsideHours: sql<number>`count(*) filter (where ${outside})::int`,
      })
      .from(conversation)
      .where(
        and(
          inArray(conversation.assistantId, workspaceAi),
          eq(conversation.isTest, false),
          exists(
            db
              .select({ id: message.id })
              .from(message)
              .where(
                and(
                  eq(message.conversationId, conversation.id),
                  eq(message.role, 'assistant'),
                  eq(message.status, 'completed'),
                  gte(message.createdAt, since),
                ),
              ),
          ),
        ),
      ),
    db
      .select({ total: count() })
      .from(conversation)
      .where(
        and(
          inArray(conversation.assistantId, workspaceAi),
          eq(conversation.isTest, false),
          gte(conversation.handedOffAt, since),
        ),
      ),
    db
      .select({ total: count() })
      .from(lead)
      .where(
        and(
          eq(lead.organizationId, organizationId),
          eq(lead.capturedVia, 'chat'),
          isNull(lead.mergedIntoLeadId),
          gte(lead.createdAt, since),
        ),
      ),
    db
      .select({
        total: count(),
        value: sql<number>`coalesce(sum(${lead.value}), 0)::bigint`,
      })
      .from(lead)
      .where(
        and(
          eq(lead.organizationId, organizationId),
          eq(lead.capturedVia, 'chat'),
          isNull(lead.mergedIntoLeadId),
          eq(lead.status, 'won'),
          gte(lead.closedAt, since),
        ),
      ),
    db
      .select({ total: count() })
      .from(knowledgeSource)
      .where(
        and(
          eq(knowledgeSource.organizationId, organizationId),
          eq(knowledgeSource.kind, 'note'),
          eq(knowledgeSource.discoveredVia, 'reply'),
          gte(knowledgeSource.createdAt, since),
        ),
      ),
  ])
  const [visitors, chatted] = await funnel
  return {
    monthStart: since.toISOString().slice(0, 10),
    customersAnswered: answered[0]?.total ?? 0,
    outsideHours: answered[0]?.outsideHours ?? 0,
    leadsCaught: caught[0]?.total ?? 0,
    leadsWon: won[0]?.total ?? 0,
    wonValue: Number(won[0]?.value ?? 0),
    neededYou: handedOff[0]?.total ?? 0,
    answersLearned: learned[0]?.total ?? 0,
    websiteVisitors:
      ai && countedTracking(ai).visits ? (visitors[0]?.total ?? 0) : null,
    visitorsChatted: chatted[0]?.total ?? 0,
  }
}

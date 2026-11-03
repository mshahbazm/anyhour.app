import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  teamChatAppNames,
  type tTeamChatApp,
} from '../../config/teamChat.config'
import { db } from '../../db'
import { connection, connectionMember } from '../../db/schema'
import { ConnectionError } from '../connections/errors'
import type { tConnection } from '../connections/types'
import { linkedAgents } from '../whatsapp/agent'
import { sendToOwner } from '../whatsapp/alerts'
import { WhatsappError } from '../whatsapp/client'
import { slackAdapter } from './slack'
import { slackActions } from '../connections/slackApi'
import { slackToken } from '../connections/slack'
import { recordAlert } from './thread'
import type { iRecipient } from '../workspace/owners'

// The notifier's chat-app side: an alert goes to every app each recipient
// linked (WhatsApp, Slack), sent by the AI, and joins the person's thread
// with it, so "send it" there has context. A Slack connection with an
// alerts channel posts there once instead of to each person.
// Callers email whoever no app reached, so email stays the fallback, and
// keep their own rules for who is alerted.

export interface iTeamAlert {
  organizationId: string
  recipients: iRecipient[]
  text: string
  /** The lead it is about, kept with the WhatsApp record. */
  leadId?: string | null
  /** Distinguishes this alert in the members' threads. */
  alertKey: string
}

export interface iTeamAlertResult {
  /** Members at least one app reached. */
  reached: Set<string>
  apps: tTeamChatApp[]
  /** Apps that were tried and failed, with why. */
  failed: tTeamChatApp[]
  errors: string[]
}

export const appList = (apps: tTeamChatApp[]) => {
  const names = apps.map((app) => teamChatAppNames[app])
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    : (names[0] ?? '')
}

async function linkedConnections(organizationId: string, memberIds: string[]) {
  if (!memberIds.length) return []
  return db
    .select({
      record: connection,
      memberId: connectionMember.memberId,
      user: connectionMember.externalUserId,
      dm: connectionMember.dmChannelId,
    })
    .from(connectionMember)
    .innerJoin(connection, eq(connection.id, connectionMember.connectionId))
    .where(
      and(
        eq(connection.organizationId, organizationId),
        eq(connection.status, 'active'),
        inArray(connectionMember.memberId, memberIds),
      ),
    )
    .orderBy(asc(connection.createdAt))
}

// One alert to a Slack channel or DM.
async function postTo(
  record: tConnection,
  channel: string,
  text: string,
  direct: boolean,
) {
  await slackAdapter.send(
    { record, channel, threadTs: null, user: null, direct },
    { text, choices: [] },
  )
}

async function directChannel(
  record: tConnection,
  user: string,
  known: string | null,
) {
  if (known) return known
  const channel = await slackActions.openDm(slackToken(record), user)
  await db
    .update(connectionMember)
    .set({ dmChannelId: channel })
    .where(
      and(
        eq(connectionMember.connectionId, record.id),
        eq(connectionMember.externalUserId, user),
      ),
    )
  return channel
}

export async function alertTeam(alert: iTeamAlert): Promise<iTeamAlertResult> {
  const { text } = alert
  const result: iTeamAlertResult = {
    reached: new Set(),
    apps: [],
    failed: [],
    errors: [],
  }
  const fail = (app: tTeamChatApp, message: string) => {
    if (!result.failed.includes(app)) result.failed.push(app)
    result.errors.push(message)
  }
  const memberIds = alert.recipients.map((person) => person.memberId)
  const reachedBy = new Map<string, tTeamChatApp>()
  const reach = (memberId: string, app: tTeamChatApp) => {
    result.reached.add(memberId)
    if (!result.apps.includes(app)) result.apps.push(app)
    if (!reachedBy.has(memberId)) reachedBy.set(memberId, app)
  }

  // WhatsApp: the person's agent.
  const agents = await linkedAgents(alert.organizationId, memberIds)
  for (const memberId of memberIds) {
    const agent = agents.find((item) => item.connectedByMemberId === memberId)
    if (!agent) continue
    try {
      await sendToOwner(agent, text, {
        kind: 'lead_alert',
        leadId: alert.leadId ?? null,
      })
      reach(memberId, 'whatsapp')
    } catch (error) {
      if (!(error instanceof WhatsappError)) throw error
      fail('whatsapp', error.message)
    }
  }

  // Slack: the person's first linked connection. A channel gets the alert
  // once.
  const links = await linkedConnections(alert.organizationId, memberIds)
  const postedChannels = new Set<string>()
  const provider = 'slack'
  for (const memberId of memberIds) {
    const chosen = links.find(
      (item) => item.memberId === memberId && item.record.provider === provider,
    )
    if (!chosen) continue
    const { record } = chosen
    const channel = record.settings.alertsChannelId
    try {
      if (channel) {
        if (!postedChannels.has(`${record.id}:${channel}`)) {
          await postTo(record, channel, text, false)
          postedChannels.add(`${record.id}:${channel}`)
        }
      } else
        await postTo(
          record,
          await directChannel(record, chosen.user, chosen.dm),
          text,
          true,
        )
      reach(memberId, provider)
    } catch (error) {
      if (!(error instanceof ConnectionError)) throw error
      fail(provider, error.message)
    }
  }

  // The alert joins each reached person's thread with the AI.
  for (const [memberId, app] of reachedBy)
    await recordAlert({
      memberId,
      app,
      text,
      alertKey: alert.alertKey,
    }).catch((error: unknown) =>
      console.error(
        'Recording an alert failed',
        error instanceof Error ? error.name : 'Unknown error',
      ),
    )
  return result
}

// After someone opens their "Link your account" link: the AI says so
// where they'll talk. Best effort.
export async function tellLinked(link: {
  connectionId: string
  externalUserId: string
  dmChannelId: string | null
}) {
  const [record] = await db
    .select()
    .from(connection)
    .where(eq(connection.id, link.connectionId))
  if (!record || record.status !== 'active') return
  try {
    await postTo(
      record,
      await directChannel(record, link.externalUserId, link.dmChannelId),
      'Linked. Message me here any time, as you would in the dashboard.',
      true,
    )
  } catch (error) {
    if (!(error instanceof ConnectionError)) throw error
  }
}

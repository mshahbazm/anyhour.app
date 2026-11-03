import { markConnection } from '../connections/store'
import { ConnectionError } from '../connections/errors'
import { slackToken } from '../connections/slack'
import { slackActions, type iSlackBlock } from '../connections/slackApi'
import type { iProviderEvent, tConnection } from '../connections/types'
import type { iTeamChatAdapter, iTeamChoice } from './adapter'
import { answerInApp, isStaleAt } from './answer'
import { chunksFor, formatFor } from './format'
import { createLinkUrl, linkedMember, linkPromptText } from './links'

// Slack: DMs to our app and @mentions in channels. A mention is answered in
// a thread under it; in a shared channel the employee acts with the
// permissions of whoever mentioned it.

export interface iSlackTarget {
  record: tConnection
  channel: string
  threadTs: string | null
  user: string | null
  direct: boolean
}

interface iSlackPayload {
  user: string
  channel: string
  text?: string
  ts?: string | null
  threadTs?: string | null
  value?: string
  direct?: boolean
}

// Slack's markup in what they wrote, back to plain text.
export function slackPlainText(text: string) {
  return text
    .replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, '')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

function choiceBlocks(choice: iTeamChoice): iSlackBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*${formatFor('slack', choice.title)}*`,
          choice.description ? formatFor('slack', choice.description) : null,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    },
    {
      type: 'actions',
      block_id: `wp:${choice.blockId}`,
      elements: choice.options.map((option, index) => ({
        type: 'button',
        text: { type: 'plain_text', text: option.label.slice(0, 75) },
        value: `${choice.blockId}|${option.value}`,
        action_id: `wp_choice_${index}`,
        ...(option.value === 'confirm' ? { style: 'primary' } : {}),
      })),
    },
  ]
}

async function guarded<T>(record: tConnection, work: () => Promise<T>) {
  try {
    return await work()
  } catch (error) {
    if (error instanceof ConnectionError && error.breaksConnection)
      await markConnection(record, 'broken', error.message)
    throw error
  }
}

export const slackAdapter: iTeamChatAdapter<iSlackTarget> = {
  app: 'slack',
  async send(target, reply) {
    await guarded(target.record, async () => {
      const token = slackToken(target.record)
      const chunks = chunksFor('slack', reply.text)
      if (!chunks.length && reply.choices.length) chunks.push('')
      for (const [index, chunk] of chunks.entries()) {
        const last = index === chunks.length - 1
        const blocks =
          last && reply.choices.length
            ? [
                ...(chunk
                  ? [{ type: 'section', text: { type: 'mrkdwn', text: chunk } }]
                  : []),
                ...reply.choices.flatMap(choiceBlocks),
              ]
            : undefined
        await slackActions.postMessage(token, {
          channel: target.channel,
          text: chunk || formatFor('slack', reply.choices[0]?.title ?? ''),
          blocks,
          thread_ts: target.threadTs,
        })
      }
    })
  },
  // In a channel only they see it: the link links whoever opens it.
  async sendLinkPrompt(target, url) {
    await guarded(target.record, async () => {
      const token = slackToken(target.record)
      const text = linkPromptText(`<${url}|Link your account>`)
      if (target.direct || !target.user)
        await slackActions.postMessage(token, {
          channel: target.channel,
          text,
          thread_ts: target.threadTs,
        })
      else
        await slackActions.postEphemeral(token, {
          channel: target.channel,
          user: target.user,
          text,
          thread_ts: target.threadTs,
        })
    })
  },
}

export async function handleSlackEvent(
  record: tConnection,
  event: iProviderEvent,
) {
  if (event.kind === 'uninstalled') {
    await markConnection(
      record,
      'disconnected',
      'Our app was removed from Slack.',
    )
    return
  }
  if (record.status !== 'active') return
  const payload = event.payload as unknown as iSlackPayload
  if (payload.ts && isStaleAt(Number(payload.ts) * 1000)) return
  const target: iSlackTarget = {
    record,
    channel: payload.channel,
    threadTs: payload.threadTs ?? null,
    user: payload.user,
    direct: Boolean(payload.direct),
  }
  const memberId = await linkedMember(record.id, payload.user)
  if (!memberId) {
    await slackAdapter.sendLinkPrompt!(
      target,
      await createLinkUrl(
        record.id,
        payload.user,
        payload.direct ? payload.channel : null,
      ),
    )
    return
  }
  const [blockId, ...value] = (payload.value ?? '').split('|')
  await answerInApp(slackAdapter, target, {
    app: 'slack',
    memberId,
    externalMessageId: payload.ts ?? event.externalEventId,
    text: event.kind === 'message' ? slackPlainText(payload.text ?? '') : '',
    choice:
      event.kind === 'action' && blockId && value.length
        ? { blockId, value: value.join('|') }
        : null,
    quoted: null,
  })
}

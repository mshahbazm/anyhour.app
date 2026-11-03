import { teamChatConfig } from '../../config/teamChat.config'
import type { iTeamChatAdapter, iTeamMessage } from './adapter'
import { teamTurn } from './turn'

// Too old to act on: a backlog or a slow queue never replays old asks.
export const isStaleAt = (sentAt: number) =>
  Date.now() - sentAt > teamChatConfig.staleMinutes * 60_000

// One linked member's message from any app: the employee answers, and the
// app delivers it.
export async function answerInApp<tTarget>(
  adapter: iTeamChatAdapter<tTarget>,
  target: tTarget,
  message: iTeamMessage,
) {
  if (!message.text.trim() && !message.choice) {
    await adapter.send(target, {
      text: 'I’m here. What can I do for you?',
      choices: [],
    })
    return
  }
  const reply = await teamTurn(message)
  if (reply) await adapter.send(target, reply)
}

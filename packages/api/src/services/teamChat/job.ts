import { processConnectionEvent } from '../connections/events'
import type { tTeamChatJob } from '../queue/boss'
import { answerWhatsapp } from './whatsapp'

// The worker's `team-chat` job: one message from a chat app.
export async function runTeamChatJob(job: tTeamChatJob) {
  if (job.source === 'whatsapp')
    await answerWhatsapp(job.agentId, job.messageId)
  else await processConnectionEvent(job.eventId)
}

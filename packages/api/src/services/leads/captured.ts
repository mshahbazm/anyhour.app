import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { lead } from '../../db/schema'
import { EmailSendError, sendEmail } from '../email/send'
import { alertTeam, appList } from '../teamChat/notify'
import { leadAlertText } from '../whatsapp/texts'
import { workspaceOwners } from '../workspace/owners'
import { writeActivity } from './activity'
import { leadDisplayName, leadSummaryLines, loadLeadView } from './leadView'
import { LeadQualificationError, qualifyLead } from './qualify'

// Retries the lead-captured job allows for a busy qualification service.
export const leadCapturedRetries = 2

// Tells the workspace's owners about a new lead: in every chat app they
// linked (WhatsApp, Slack; docs/teamChat.md), and by email to everyone no
// app reached. Best effort: a failed alert never fails the capture; the lead
// is on the Leads page either way.
async function alertLeadCaptured(organizationId: string, leadId: string) {
  const view = await loadLeadView(leadId)
  const owners = await workspaceOwners(organizationId)
  if (!view || !owners.length) return
  const apps = await alertTeam({
    organizationId,
    recipients: owners,
    text: await leadAlertText(view),
    leadId,
    alertKey: `lead:${leadId}`,
  })
  const emailTo = owners.filter((person) => !apps.reached.has(person.memberId))
  const emailed: string[] = []
  for (const person of emailTo) {
    try {
      await sendEmail({
        to: person.email,
        subject: `${leadDisplayName(view)}: ${view.lead.title}`,
        text: [...leadSummaryLines(view), '', view.botName].join('\n'),
        // A retried job doesn't email the same person twice.
        idempotencyKey: `lead-captured:${leadId}:${person.memberId}`,
      })
      emailed.push(person.email)
    } catch (error) {
      if (!(error instanceof EmailSendError)) throw error
      console.error('Lead alert email failed', error.message)
    }
  }
  if (!apps.reached.size && !emailed.length) return
  const via = [
    ...(apps.reached.size ? [`on ${appList(apps.apps)}`] : []),
    ...(emailed.length ? ['by email'] : []),
  ].join(' and ')
  await writeActivity(db, {
    organizationId,
    leadId,
    kind: 'owner_notified',
    title: `Told you ${via}`,
    detail: {
      channel: [...apps.apps, ...(emailed.length ? ['email'] : [])].join(','),
      to: emailed,
      ...(apps.errors.length ? { appError: apps.errors[0] } : {}),
    },
  })
}

// The lead-captured job, run once a capture has committed: qualify the lead
// (best effort), then alert the owners. A temporarily
// unavailable model throws so pg-boss retries; on the last try the lead goes
// on unqualified. A retry never qualifies twice (a stored qualification is
// kept); the alert comes after the last point that can throw.
export async function handleLeadCaptured(leadId: string, retryCount = 0) {
  const [current] = await db
    .select({ qualification: lead.qualification })
    .from(lead)
    .where(eq(lead.id, leadId))
    .limit(1)
  if (!current) return
  try {
    if (!current.qualification) await qualifyLead(leadId)
  } catch (error) {
    if (
      error instanceof LeadQualificationError &&
      error.retryable &&
      retryCount < leadCapturedRetries
    )
      throw error
    console.error(
      'Lead qualification skipped',
      error instanceof Error ? error.name : 'Unknown error',
    )
  }
  const [record] = await db
    .select({ organizationId: lead.organizationId })
    .from(lead)
    .where(and(eq(lead.id, leadId), isNull(lead.mergedIntoLeadId)))
    .limit(1)
  if (!record) return
  await alertLeadCaptured(record.organizationId, leadId).catch(
    (error: unknown) =>
      console.error(
        'Lead alert failed',
        error instanceof Error ? error.name : 'Unknown error',
      ),
  )
}

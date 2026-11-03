import { AlertCircle, Check, ChevronRight, Loader2 } from 'lucide-react'
import type { iWorkspaceAction } from './types'

// [while running, once finished]. Tools that only render UI or load instructions stay hidden.
const labels: Record<string, [string, string]> = {
  get_context: ['Checking your workspace', 'Checked your workspace'],
  get_profile: ['Reading your profile', 'Read your profile'],
  update_profile_name: ['Updating your name', 'Updated your name'],
  get_workspace: ['Reading workspace settings', 'Read workspace settings'],
  update_workspace: ['Saving workspace settings', 'Saved workspace settings'],
  create_workspace: ['Creating your workspace', 'Created your workspace'],
  set_bot_goal: ['Saving my goal', 'Saved my goal'],
  list_sources: ['Reviewing sources', 'Reviewed sources'],
  add_source: ['Adding a source', 'Added a source'],
  // Saving first checks the website and may ask instead, so say what's certain.
  add_knowledge_note: [
    'Checking with your website',
    'Checked with your website',
  ],
  list_knowledge_notes: ['Checking what I know', 'Checked what I know'],
  update_knowledge_note: [
    'Checking with your website',
    'Checked with your website',
  ],
  save_confirmed_fact: ['Saving your answer', 'Saved your answer'],
  search_knowledge: ['Looking it up', 'Looked it up'],
  resolve_website_change: ['Applying your choice', 'Applied your choice'],
  remove_knowledge_note: ['Forgetting that', 'Forgot that'],
  draft_member_rules: ['Writing that as a rule', 'Wrote that as a rule'],
  save_member_rules: ['Saving the rules', 'Saved the rules'],
  update_member_rule: ['Updating a rule', 'Updated a rule'],
  order_member_rules: ['Reordering rules', 'Reordered rules'],
  delete_member_rule: ['Removing a rule', 'Removed a rule'],
  rename_bot: ['Renaming', 'Renamed'],
  create_bot_picture: ['Creating my picture', 'Created my picture'],
  list_leads: ['Checking leads', 'Checked leads'],
  list_visitor_conversations: ['Reading visitor chats', 'Read visitor chats'],
  find_contacts: ['Looking up contacts', 'Looked up contacts'],
  contact_details: ['Reading the contact', 'Read the contact'],
  remember_contact_fact: ['Remembering that', 'Remembered that'],
  forget_contact_fact: ['Forgetting that', 'Forgot that'],
  add_contact: ['Adding the contact', 'Added the contact'],
  update_contact: ['Updating the contact', 'Updated the contact'],
  add_lead_person: ['Adding them to the deal', 'Added them to the deal'],
  inspect_source: ['Reading source', 'Read source'],
  refresh_source: ['Queuing a refresh', 'Queued a refresh'],
  set_source_included: ['Updating source', 'Updated source'],
  indexing_status: ['Checking reading', 'Checked reading'],
  my_sources: ['Checking what I learn from', 'Checked what I learn from'],
  list_team: ['Checking your team', 'Checked your team'],
  invite_member: ['Sending invitation', 'Sent invitation'],
  update_member_role: ['Changing role', 'Changed role'],
  cancel_invitation: ['Cancelling invitation', 'Cancelled invitation'],
  request_member_removal: ['Preparing confirmation', 'Asked for confirmation'],
  remove_member: ['Removing member', 'Removed member'],
}
export const hiddenActions = new Set(['read_skill', 'show_choices'])

function label(action: iWorkspaceAction) {
  const pair = labels[action.name] as [string, string] | undefined
  const fallback = action.name.replaceAll('_', ' ')
  if (action.status === 'running') return `${pair?.[0] ?? fallback}…`
  if (action.status === 'failed') return `${pair?.[0] ?? fallback} failed`
  if (action.status === 'unknown')
    return `${pair?.[0] ?? fallback} — outcome unknown`
  return pair?.[1] ?? fallback
}

function Step({ action }: { action: iWorkspaceAction }) {
  return (
    <li className={`activityStep is-${action.status}`}>
      {action.status === 'running' ? (
        <Loader2 className="spin" size={13} />
      ) : action.status === 'completed' ? (
        <Check size={13} />
      ) : (
        <AlertCircle size={13} />
      )}
      {label(action)}
    </li>
  )
}

export function ActivitySteps({
  actions,
  live,
}: {
  actions: iWorkspaceAction[]
  live: boolean
}) {
  const visible = actions.filter((action) => !hiddenActions.has(action.name))
  if (!visible.length) return null
  if (live)
    return (
      <ul className="activitySteps" aria-live="polite">
        {visible.map((action) => (
          <Step key={action.id} action={action} />
        ))}
      </ul>
    )
  const problems = visible.filter((action) => action.status !== 'completed')
  return (
    <details className="activitySummary">
      <summary>
        <ChevronRight size={13} className="chevron" />
        {problems.length
          ? `${problems.length} of ${visible.length} steps need attention`
          : `${visible.length} ${visible.length === 1 ? 'step' : 'steps'}`}
      </summary>
      <ul className="activitySteps">
        {visible.map((action) => (
          <Step key={action.id} action={action} />
        ))}
      </ul>
    </details>
  )
}

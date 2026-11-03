import addKnowledge from './add-knowledge/SKILL.md' with { type: 'text' }
import botGoal from './bot-goal/SKILL.md' with { type: 'text' }
import botProfile from './bot-profile/SKILL.md' with { type: 'text' }
import changeMemberRole from './change-member-role/SKILL.md' with { type: 'text' }
import contactMemory from './contact-memory/SKILL.md' with { type: 'text' }
import leadPeople from './lead-people/SKILL.md' with { type: 'text' }
import leadStatus from './lead-status/SKILL.md' with { type: 'text' }
import finishSetup from './finish-setup/SKILL.md' with { type: 'text' }
import goLive from './go-live/SKILL.md' with { type: 'text' }
import inviteTeamMember from './invite-team-member/SKILL.md' with { type: 'text' }
import manageContacts from './manage-contacts/SKILL.md' with { type: 'text' }
import memberRules from './member-rules/SKILL.md' with { type: 'text' }
import gettingStarted from './getting-started/SKILL.md' with { type: 'text' }
import removeTeamMember from './remove-team-member/SKILL.md' with { type: 'text' }
import supportInbox from './support-inbox/SKILL.md' with { type: 'text' }
import reviewKnowledge from './review-knowledge/SKILL.md' with { type: 'text' }
import visitorActivity from './visitor-activity/SKILL.md' with { type: 'text' }
import workspaceSettings from './workspace-settings/SKILL.md' with { type: 'text' }

/**
 * Skills are task procedures in `skills/<name>/SKILL.md`: frontmatter with
 * `name`, `description` (shown in the prompt catalog), `tools` (the tools
 * the procedure uses) and optionally `when: new` (listed only while the AI
 * is new), then a markdown body the agent loads with read_skill.
 * Adding a skill = add its folder and one import line above.
 */
export interface iSkill {
  name: string
  description: string
  tools: string[]
  /** Listed in the catalog only while the AI is new. */
  onlyWhenNew: boolean
  body: string
}

const sources = [
  gettingStarted,
  finishSetup,
  addKnowledge,
  reviewKnowledge,
  botProfile,
  botGoal,
  memberRules,
  goLive,
  visitorActivity,
  supportInbox,
  contactMemory,
  manageContacts,
  leadStatus,
  leadPeople,
  workspaceSettings,
  inviteTeamMember,
  changeMemberRole,
  removeTeamMember,
]

export function parseSkill(source: string): iSkill {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source.trim())
  if (!match) throw new Error('Skill is missing its frontmatter')
  const fields = new Map(
    match[1].split('\n').map((line) => {
      const separator = line.indexOf(':')
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
    }),
  )
  const name = fields.get('name') ?? ''
  const description = fields.get('description') ?? ''
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))
    throw new Error(`Invalid skill name "${name}"`)
  if (!description || description.length > 1024)
    throw new Error(
      `Skill "${name}" needs a description of up to 1024 characters`,
    )
  return {
    name,
    description,
    tools: (fields.get('tools') ?? '')
      .split(',')
      .map((tool) => tool.trim())
      .filter(Boolean),
    onlyWhenNew: fields.get('when') === 'new',
    body: match[2].trim(),
  }
}

export const workspaceSkills: readonly iSkill[] = sources.map(parseSkill)

const byName = new Map(workspaceSkills.map((skill) => [skill.name, skill]))
if (byName.size !== workspaceSkills.length)
  throw new Error('Duplicate workspace skill names')

export const skillNames = workspaceSkills.map((skill) => skill.name) as [
  string,
  ...string[],
]

/** Accepts kebab or snake case, since models mix them up. */
export function getSkill(name: string) {
  return byName.get(name.trim().toLowerCase().replace(/_/g, '-'))
}

/**
 * The catalog in the system prompt: names and descriptions only. Skills for
 * a new AI are left out once it has settled in, so they cost nothing.
 */
export function skillCatalog(options: { isNew?: boolean } = {}) {
  return [
    '<available_skills>',
    ...workspaceSkills
      .filter((skill) => options.isNew || !skill.onlyWhenNew)
      .map(
        (skill) =>
          `  <skill><name>${skill.name}</name><description>${skill.description}</description></skill>`,
      ),
    '</available_skills>',
  ].join('\n')
}

import { describe, expect, test } from 'bun:test'
import { buildWorkspaceTools } from '../../src/services/workspaceAgent/tools'
import {
  getSkill,
  parseSkill,
  skillCatalog,
  workspaceSkills,
} from '../../src/services/workspaceAgent/skills/loader'
import { buildSystemPrompt } from '../../src/services/workspaceAgent/systemPrompt'

// Available in every turn regardless of skill.
const coreTools = new Set(['read_skill', 'get_context', 'show_choices'])

const context = {
  headers: new Headers(),
  dispatch: () => new Response(),
  chatId: 'skills',
  messageId: 'skills',
  signal: new AbortController().signal,
  emit: () => undefined,
}
const toolNames = new Set(buildWorkspaceTools(context).map((tool) => tool.name))

describe('workspace skills', () => {
  test('every declared tool exists and is used in its procedure', () => {
    for (const skill of workspaceSkills)
      for (const tool of skill.tools) {
        expect(toolNames.has(tool), `${skill.name} → ${tool}`).toBe(true)
        expect(skill.body.includes(tool), `${skill.name} body → ${tool}`).toBe(
          true,
        )
      }
  })

  test('every non-core tool belongs to at least one skill', () => {
    const covered = new Set(workspaceSkills.flatMap((skill) => skill.tools))
    const orphans = [...toolNames].filter(
      (tool) => !coreTools.has(tool) && !covered.has(tool),
    )
    expect(orphans).toEqual([])
  })

  test('lookup tolerates snake case and the catalog lists every skill', () => {
    expect(getSkill('invite_team_member')?.name).toBe('invite-team-member')
    for (const skill of workspaceSkills)
      expect(skillCatalog({ isNew: true })).toContain(
        `<name>${skill.name}</name>`,
      )
  })

  test('the getting-started skill is listed only while the AI is new', () => {
    expect(getSkill('getting-started')?.onlyWhenNew).toBe(true)
    expect(skillCatalog()).not.toContain('<name>getting-started</name>')
    expect(skillCatalog({ isNew: true })).toContain(
      '<name>getting-started</name>',
    )
  })

  test('frontmatter is validated', () => {
    expect(() => parseSkill('# no frontmatter')).toThrow()
    expect(() =>
      parseSkill('---\nname: Bad Name\ndescription: x\n---\nbody'),
    ).toThrow()
  })

  test('system prompt states known facts and quotes the bot name', () => {
    const prompt = buildSystemPrompt({
      bot: {
        name: 'Maya "the bot"',
        goal: 'enquiries',
        hasPicture: false,
        status: 'draft',
        sources: 0,
        rules: [
          {
            id: 'r1',
            kind: 'rule',
            tag: 'askFirst',
            text: 'Ask dates',
            when: null,
            steps: null,
            position: 0,
          },
        ],
        overview: null,
        gaps: [],
        notes: [],
        decisions: [],
        installs: [],
      },
      recentChoices: [],
      recentOutcomes: [],
    })
    expect(prompt).toContain('Goal: enquiries')
    expect(prompt).toContain('Profile picture: none yet')
    expect(prompt).toContain(JSON.stringify('Maya "the bot"'))
    expect(prompt).toContain('<available_skills>')
    expect(prompt).toContain('{"id":"r1","rule":"Ask dates","tag":"askFirst"}')
    expect(prompt).toContain('Rules not set yet: never, tone, handOver')
  })

  test('the AI has its tools and none for adding or choosing AIs', () => {
    const tools = new Set(toolNames)
    expect(tools.has('list_needs_you')).toBe(true)
    expect(tools.has('create_rule')).toBe(false)
    expect(tools.has('draft_member_rules')).toBe(true)
    expect(tools.has('update_behaviour')).toBe(false)
    for (const removed of [
      'create_assistant',
      'select_assistant',
      'propose_team_members',
      'assign_channel',
      'move_website_to_new_member',
    ])
      expect(tools.has(removed)).toBe(false)
  })

  test('one prompt covers the website', () => {
    const bot = {
      name: 'Leo',
      goal: null,
      hasPicture: true,
      status: 'draft',
      sources: 0,
      rules: [],
      overview: null,
      gaps: [],
      notes: [],
      decisions: [],
      installs: [],
    }
    const prompt = buildSystemPrompt({
      bot,
      workspace: {
        idealCustomerProfile: 'Bakery "in Leeds"',
        whatsappLinked: false,
      },
      recentChoices: [],
      recentOutcomes: [],
    })
    expect(prompt).toContain('You are "Leo", the business\'s AI')
    expect(prompt).toContain(JSON.stringify('Bakery "in Leeds"'))
    expect(prompt).toContain('# Chief of staff')
    expect(prompt).toContain('<name>support-inbox</name>')
    expect(prompt).toContain('Chat code seen on')
  })
})

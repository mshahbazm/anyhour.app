import {
  ArrowDown,
  ArrowUp,
  Loader2,
  MoreHorizontal,
  Pencil,
  ScrollText,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdownMenu'
import { problem } from '../workspace/api'
import { PageHeader } from '../workspace/pageHeader'
import type { iAssistant } from '../workspace/types'
import {
  draftRules,
  orderRules,
  removeRule,
  saveRules,
  updateRule,
  useMemberRules,
} from './api'
import type { iMemberRule, iMemberRuleDraft, tRuleTag } from './api'
import { editorReady, RuleEditor } from './ruleEditor'
import { RuleLine, StepsCard } from './ruleViews'
import './memberRules.css'

interface iRulesPageProps {
  organizationId: string
  bot: iAssistant
  canEdit: boolean
}

// How the AI talks to customers, in the two ways the owner's guidance
// reaches it: rules it keeps in every conversation, and steps it follows in
// order when their situation comes up. Everything is added from plain
// words: drafted, checked, saved.
export function RulesPage(props: iRulesPageProps) {
  const { bot } = props
  const { rules, error: loadError, set } = useMemberRules(props.organizationId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  // The add box, so an example can fill it.
  const [text, setText] = useState('')

  async function run(work: () => Promise<iMemberRule[]>) {
    setBusy(true)
    setError('')
    try {
      set(await work())
      return true
    } catch (cause) {
      setError(problem(cause, 'Couldn’t save. Try again.'))
      return false
    } finally {
      setBusy(false)
    }
  }

  // Up or down past the next rule of the same kind.
  function move(rule: iMemberRule, by: -1 | 1) {
    if (!rules) return
    const peers = rules.filter((other) => other.kind === rule.kind)
    const swapWith = peers[peers.indexOf(rule) + by] as iMemberRule | undefined
    if (!swapWith) return
    const ids = rules.map((item) =>
      item.id === rule.id
        ? swapWith.id
        : item.id === swapWith.id
          ? rule.id
          : item.id,
    )
    void run(() => orderRules(props.organizationId, ids))
  }

  function menu(rule: iMemberRule) {
    if (!props.canEdit || !rules) return null
    const peers = rules.filter((other) => other.kind === rule.kind)
    const index = peers.indexOf(rule)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="ruleIconButton ruleMenu"
              aria-label="Rule options"
              disabled={busy}
            />
          }
        >
          <MoreHorizontal size={15} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={() => setEditing(rule.id)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          {index > 0 && (
            <DropdownMenuItem onClick={() => move(rule, -1)}>
              <ArrowUp /> Move up
            </DropdownMenuItem>
          )}
          {index < peers.length - 1 && (
            <DropdownMenuItem onClick={() => move(rule, 1)}>
              <ArrowDown /> Move down
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              void run(() => removeRule(props.organizationId, rule.id))
            }
          >
            <Trash2 /> Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  function editor(rule: iMemberRule) {
    return (
      <EditInPlace
        rule={rule}
        busy={busy}
        onCancel={() => setEditing(null)}
        onSave={async (next) => {
          const saved = await run(() =>
            updateRule(props.organizationId, rule.id, {
              text: next.text.trim(),
              ...(next.kind === 'steps'
                ? {
                    when: next.when?.trim() ?? '',
                    steps: (next.steps ?? [])
                      .map((step) => step.trim())
                      .filter(Boolean),
                  }
                : {}),
            }),
          )
          if (saved) setEditing(null)
        }}
      />
    )
  }

  const lines = rules?.filter((rule) => rule.kind === 'rule') ?? []
  const steps = rules?.filter((rule) => rule.kind === 'steps') ?? []
  // An example fills the add box, so it can be changed before Preview.
  const example = (value: string) =>
    props.canEdit && (
      <button
        type="button"
        className="ruleExample"
        onClick={() => {
          setText(value)
          document.getElementById('add-rule')?.focus()
        }}
      >
        “{value}”
      </button>
    )

  return (
    <div className="page rulesPage">
      <PageHeader
        icon={<ScrollText size={18} />}
        title={`How ${bot.name} talks to customers`}
        description="Rules it keeps in every chat, and steps it follows when a situation comes up."
      />
      {props.canEdit && (
        <AddRule
          organizationId={props.organizationId}
          bot={bot}
          text={text}
          onText={setText}
          onSaved={(list) => set(list)}
        />
      )}
      {(error || loadError) && (
        <p className="inlineError" role="alert">
          {error || loadError}
        </p>
      )}
      {rules === null ? (
        !loadError && <p className="rulesEmpty">Loading…</p>
      ) : (
        <>
          <section className="rulesGroup" aria-labelledby="rules-title">
            <div className="rulesGroupHead">
              <h2 id="rules-title">In every chat</h2>
              <p>{bot.name} keeps these whatever the customer asks.</p>
            </div>
            {lines.length ? (
              <div className="ruleList">
                {ruleGroups.map((group) => {
                  const inGroup = lines.filter(
                    (rule) => (rule.tag ?? 'other') === group.tag,
                  )
                  if (!inGroup.length) return null
                  return (
                    <section key={group.tag} aria-label={group.label}>
                      <h3 className="ruleGroupLabel">{group.label}</h3>
                      <ul>
                        {inGroup.map((rule) => (
                          <li key={rule.id}>
                            {editing === rule.id ? (
                              editor(rule)
                            ) : (
                              <>
                                <span className="ruleText">{rule.text}</span>
                                {menu(rule)}
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )
                })}
              </div>
            ) : (
              <div className="rulesNone">
                <span>None yet. For example:</span>
                {example('Keep answers short and friendly')}
                {example('Never promise a price before you know the job')}
                {example(
                  'Always ask for their phone number before the chat ends',
                )}
              </div>
            )}
          </section>

          <section className="rulesGroup" aria-labelledby="steps-title">
            <div className="rulesGroupHead">
              <h2 id="steps-title">When a situation comes up</h2>
              <p>
                {bot.name} follows the steps in order, skipping anything the
                customer already said.
              </p>
            </div>
            {steps.length ? (
              <div className="stepsList">
                {steps.map((rule) =>
                  editing === rule.id ? (
                    <div key={rule.id} className="stepsCard is-editing">
                      {editor(rule)}
                    </div>
                  ) : (
                    <StepsCard
                      key={rule.id}
                      rule={rule}
                      botName={bot.name}
                      actions={menu(rule)}
                    />
                  ),
                )}
              </div>
            ) : (
              <div className="rulesNone">
                <span>None yet. For example:</span>
                {example(
                  'When someone asks for a quote, ask what they need, when they need it and their budget, then their phone number',
                )}
                {example(
                  'When someone wants to book today, take their name and number and hand over to me',
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

// One-line rules grouped by what they do, in reading order.
const ruleGroups: Array<{ tag: tRuleTag | 'other'; label: string }> = [
  { tag: 'tone', label: 'How it sounds' },
  { tag: 'askFirst', label: 'What it finds out first' },
  { tag: 'always', label: 'Always' },
  { tag: 'never', label: 'Never' },
  { tag: 'handOver', label: 'When it hands over to you' },
  { tag: 'other', label: 'Other' },
]

function EditInPlace(props: {
  rule: iMemberRule
  busy: boolean
  onCancel: () => void
  onSave: (value: iMemberRuleDraft) => Promise<void>
}) {
  const [value, setValue] = useState<iMemberRuleDraft>(props.rule)
  return (
    <form
      className="ruleEditForm"
      onSubmit={(event) => {
        event.preventDefault()
        if (editorReady(value)) void props.onSave(value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') props.onCancel()
      }}
    >
      <RuleEditor
        value={value}
        onChange={setValue}
        disabled={props.busy}
        autoFocus
      />
      <div className="ruleFormActions">
        <Button
          type="submit"
          size="sm"
          disabled={props.busy || !editorReady(value)}
        >
          {props.busy ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={props.busy}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

// Add a rule: plain words in, a preview to check (and edit), then Save.
function AddRule(props: {
  organizationId: string
  bot: iAssistant
  text: string
  onText: (text: string) => void
  onSaved: (rules: iMemberRule[]) => void
}) {
  const { text, onText: setText } = props
  const [drafts, setDrafts] = useState<iMemberRuleDraft[]>([])
  const [working, setWorking] = useState<'draft' | 'save' | null>(null)
  const [error, setError] = useState('')

  async function preview(event: FormEvent) {
    event.preventDefault()
    if (!text.trim() || working) return
    setWorking('draft')
    setError('')
    try {
      const result = await draftRules(props.organizationId, text.trim())
      if (!result.drafts.length)
        setError(
          'That doesn’t read as a rule. Facts like prices or opening hours go to Your business.',
        )
      setDrafts(result.drafts)
    } catch (cause) {
      setError(problem(cause, 'Couldn’t read that. Try again.'))
    } finally {
      setWorking(null)
    }
  }

  async function save() {
    setWorking('save')
    setError('')
    try {
      props.onSaved(
        await saveRules(
          props.organizationId,
          drafts.map((draft) => ({
            ...draft,
            text: draft.text.trim(),
            when: draft.when?.trim() ?? null,
            steps:
              draft.steps?.map((step) => step.trim()).filter(Boolean) ?? null,
          })),
        ),
      )
      setDrafts([])
      setText('')
    } catch (cause) {
      setError(problem(cause, 'Couldn’t save. Try again.'))
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="addRule">
      <form className="addRuleForm" onSubmit={(event) => void preview(event)}>
        <label className="sr-only" htmlFor="add-rule">
          Add a rule
        </label>
        <textarea
          id="add-rule"
          className="textField"
          rows={2}
          value={text}
          maxLength={4000}
          placeholder={`Tell ${props.bot.name} how to talk to customers, in your own words`}
          disabled={working !== null}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <Button
          type="submit"
          size="sm"
          variant={drafts.length ? 'outline' : 'default'}
          disabled={working !== null || !text.trim()}
        >
          {working === 'draft' ? <Loader2 className="spin" /> : <Sparkles />}
          {working === 'draft' ? 'Reading…' : 'Preview'}
        </Button>
      </form>
      {error && (
        <p className="inlineError" role="alert">
          {error}
        </p>
      )}
      {drafts.length > 0 && (
        <div className="ruleDrafts" aria-label="Rules to save">
          {drafts.map((draft, index) => (
            <DraftPreview
              key={index}
              draft={draft}
              disabled={working !== null}
              onChange={(next) =>
                setDrafts((list) =>
                  list.map((item, i) => (i === index ? next : item)),
                )
              }
            />
          ))}
          <div className="ruleFormActions">
            <Button
              size="sm"
              disabled={working !== null || !drafts.every(editorReady)}
              onClick={() => void save()}
            >
              {working === 'save' ? 'Saving…' : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={working !== null}
              onClick={() => setDrafts([])}
            >
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// One drafted rule as it will read, with Edit at hand.
function DraftPreview(props: {
  draft: iMemberRuleDraft
  disabled: boolean
  onChange: (value: iMemberRuleDraft) => void
}) {
  const [editing, setEditing] = useState(false)
  const { draft } = props
  if (editing)
    return (
      <div className="ruleDraft">
        <RuleEditor
          value={draft}
          disabled={props.disabled}
          autoFocus
          onChange={props.onChange}
        />
        <div className="ruleFormActions">
          <Button
            size="sm"
            variant="outline"
            disabled={!editorReady(draft)}
            onClick={() => setEditing(false)}
          >
            Done
          </Button>
        </div>
      </div>
    )
  return (
    <div className="ruleDraft">
      {draft.kind === 'steps' ? (
        <StepsCard rule={draft} />
      ) : (
        <RuleLine rule={draft} />
      )}
      <div className="ruleDraftControls">
        <Button
          size="sm"
          variant="ghost"
          disabled={props.disabled}
          onClick={() => setEditing(true)}
        >
          <Pencil /> Edit
        </Button>
      </div>
    </div>
  )
}

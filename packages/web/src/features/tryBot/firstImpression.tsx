import { brandStyle, greeting, WhatsappIcon } from '@anyhour/widget'
import { Pencil, Plus, RefreshCw, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { BotAvatar } from '../bots/botAvatar'
import { problem } from '../workspace/api'
import type { iAssistant, tOwnerAppearance } from '../workspace/types'
import {
  findWhatsappNumber,
  removeWhatsappQuestion,
  WhatsappPanel,
} from './whatsappQuestion'
import type { iWhatsappDraft } from './whatsappQuestion'

const limits = { questions: 4, questionLength: 80, ideas: 2 }

// The greeting and starter questions, edited right where visitors see them:
// a small chat with the bot's first bubble and the questions to tap.
export function FirstImpression(props: {
  bot: iAssistant | undefined
  organizationId: string | null
  appearance: tOwnerAppearance
  welcome: string
  disabled: boolean
  onWelcome: (text: string) => void
  onQuestions: (questions: string[]) => void
  /** The WhatsApp question was saved or removed: the refreshed AI. */
  onWhatsapp: (bot: iAssistant) => void
}) {
  const [adding, setAdding] = useState(false)
  const [whatsappDraft, setWhatsappDraft] = useState<iWhatsappDraft | null>(
    null,
  )
  const [whatsappBusy, setWhatsappBusy] = useState(false)
  const [whatsappError, setWhatsappError] = useState('')
  const whatsapp = props.appearance.whatsapp ?? null
  const organizationId = props.organizationId
  const botId = props.bot?.id
  const [draft, setDraft] = useState('')
  const [page, setPage] = useState(0)
  const name = props.bot?.name ?? 'your AI'
  const questions = props.appearance.starterPrompts
  const full = questions.length >= limits.questions
  const suggestions = (
    props.bot?.knowledgeOverview?.starterQuestions ?? []
  ).filter(
    (item) =>
      !questions.some(
        (existing) => existing.toLowerCase() === item.toLowerCase(),
      ),
  )
  // A couple at a time; the refresh button shows the next ones.
  const start = suggestions.length
    ? (page * limits.ideas) % suggestions.length
    : 0
  const ideas = [...suggestions, ...suggestions]
    .slice(start, start + limits.ideas)
    .filter((item, index, all) => all.indexOf(item) === index)

  function add(question: string) {
    const value = question.trim()
    if (!value || full || questions.includes(value)) return
    props.onQuestions([...questions, value])
  }

  async function startWhatsapp() {
    if (!organizationId || !botId) return
    setWhatsappBusy(true)
    setWhatsappError('')
    const found = await findWhatsappNumber(organizationId, botId)
    setWhatsappBusy(false)
    setWhatsappDraft({ saved: null, found })
  }

  async function removeWhatsapp() {
    if (!organizationId || !botId) return
    setWhatsappBusy(true)
    setWhatsappError('')
    try {
      props.onWhatsapp(await removeWhatsappQuestion(organizationId, botId))
    } catch (cause) {
      setWhatsappError(
        problem(cause, 'Could not remove the WhatsApp question.'),
      )
    } finally {
      setWhatsappBusy(false)
    }
  }

  return (
    <section className="lookSection" aria-label="What visitors see first">
      <header className="lookSectionHead">
        <h3>What visitors see first</h3>
        <p>
          Click the greeting to change it. Questions below it are one tap for
          visitors to ask.
        </p>
      </header>

      <div className="firstStage" style={brandStyle(props.appearance)}>
        <div className="firstGreeting">
          <BotAvatar
            bot={props.bot}
            organizationId={props.organizationId}
            size={28}
          />
          <label className="greetingBubble">
            <span className="sr-only">Greeting</span>
            <textarea
              aria-label="Greeting"
              rows={1}
              placeholder={greeting(name, '')}
              value={props.welcome === 'How can I help?' ? '' : props.welcome}
              maxLength={500}
              disabled={props.disabled}
              onChange={(event) => props.onWelcome(event.target.value)}
            />
            <Pencil size={12} className="editHint" aria-hidden="true" />
          </label>
        </div>

        <ul className="firstQuestions" aria-label="Starter questions">
          {questions.map((question) => (
            <li key={question}>
              <span>{question}</span>
              <button
                type="button"
                aria-label={`Remove “${question}”`}
                disabled={props.disabled}
                onClick={() =>
                  props.onQuestions(
                    questions.filter((item) => item !== question),
                  )
                }
              >
                <X size={12} />
              </button>
            </li>
          ))}
          {whatsapp && !whatsappDraft && (
            <li className="is-whatsapp">
              <button
                type="button"
                className="whatsappChip"
                aria-label={`Edit “${whatsapp.question}”`}
                disabled={props.disabled || whatsappBusy}
                onClick={() =>
                  setWhatsappDraft({
                    saved: whatsapp,
                    found: { number: null, source: null },
                  })
                }
              >
                <WhatsappIcon size={14} />
                <span>{whatsapp.question}</span>
              </button>
              <button
                type="button"
                aria-label={`Remove “${whatsapp.question}”`}
                disabled={props.disabled || whatsappBusy}
                onClick={() => void removeWhatsapp()}
              >
                <X size={12} />
              </button>
            </li>
          )}
          {!full && adding && (
            <li className="is-adding">
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  add(draft)
                  setDraft('')
                  setAdding(false)
                }}
              >
                <input
                  aria-label="New starter question"
                  placeholder="Type a question…"
                  value={draft}
                  maxLength={limits.questionLength}
                  autoFocus
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => {
                    if (!draft.trim()) setAdding(false)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setDraft('')
                      setAdding(false)
                    }
                  }}
                />
              </form>
            </li>
          )}
          {((!full && !adding) || (!whatsapp && !whatsappDraft)) && (
            <li className="is-adds">
              {!full && !adding && (
                <button
                  type="button"
                  disabled={props.disabled}
                  onClick={() => setAdding(true)}
                >
                  <Plus size={13} /> Add a question
                </button>
              )}
              {!whatsapp && !whatsappDraft && (
                <button
                  type="button"
                  disabled={props.disabled || whatsappBusy || !botId}
                  onClick={() => void startWhatsapp()}
                >
                  <Plus size={13} /> WhatsApp
                </button>
              )}
            </li>
          )}
        </ul>
        {whatsappDraft && organizationId && botId && (
          <WhatsappPanel
            organizationId={organizationId}
            botId={botId}
            draft={whatsappDraft}
            onCancel={() => setWhatsappDraft(null)}
            onSaved={(bot) => {
              setWhatsappDraft(null)
              props.onWhatsapp(bot)
            }}
          />
        )}
        {whatsappError && (
          <p className="whatsappError" role="alert">
            {whatsappError}
          </p>
        )}
        <small className="firstCount">
          {questions.length} of {limits.questions} questions
        </small>
      </div>

      {!full && ideas.length > 0 && (
        <div className="botSuggests">
          <div className="botSuggestsHead">
            <Sparkles size={14} />
            <strong>{name} suggests</strong>
            {suggestions.length > limits.ideas && (
              <button
                type="button"
                className="iconButton"
                aria-label="Show other suggestions"
                title="Show other suggestions"
                onClick={() => setPage((value) => value + 1)}
              >
                <RefreshCw size={13} />
              </button>
            )}
          </div>
          <p>Questions {name} can answer well, based on what it has learned.</p>
          <div className="botSuggestsList">
            {ideas.map((idea) => (
              <button
                key={idea}
                type="button"
                disabled={props.disabled}
                onClick={() => add(idea)}
              >
                <Plus size={13} />
                {idea}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

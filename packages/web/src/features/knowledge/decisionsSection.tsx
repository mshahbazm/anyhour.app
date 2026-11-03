import { Globe, MessageSquareQuote } from 'lucide-react'
import { useState } from 'react'
import type { iWebsiteDecision } from '../workspace/types'

interface iDecisionsProps {
  decisions: iWebsiteDecision[]
  botName: string
  canEdit: boolean
  disabled: boolean
  onResolve: (
    decision: iWebsiteDecision,
    choice: 'keep' | 'useWebsite',
  ) => Promise<void>
}

// A page changed and now disagrees with something the owner told the bot.
// The bot keeps the owner's version until they pick one; with none, nothing shows.
export function DecisionsSection(props: iDecisionsProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  if (!props.decisions.length) return null

  async function choose(
    decision: iWebsiteDecision,
    choice: 'keep' | 'useWebsite',
  ) {
    setBusy(decision.id)
    setFailed(null)
    try {
      await props.onResolve(decision, choice)
    } catch {
      setFailed(decision.id)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      className="knowledgeSection gapsSection"
      aria-labelledby="decisions"
    >
      <div className="knowledgeSectionHead">
        <h2 id="decisions">
          <span className="gapsDot" aria-hidden="true" />
          Your website changed
          <span className="knowledgeCount">{props.decisions.length}</span>
        </h2>
        <p>
          These pages now say something different from what you told{' '}
          {props.botName}. It keeps using yours until you choose.
        </p>
      </div>
      <ul className="gapList decisionList">
        {props.decisions.map((decision) => {
          const pending = busy === decision.id
          return (
            <li key={decision.id} className={pending ? 'is-pending' : ''}>
              <div className="decisionCompare">
                <div>
                  <small>
                    <Globe size={12} aria-hidden="true" />
                    {decision.page ?? 'Your website'} now says
                  </small>
                  <strong>
                    {decision.websiteNow ?? decision.websiteBefore}
                  </strong>
                </div>
                <div>
                  <small>
                    <MessageSquareQuote size={12} aria-hidden="true" />
                    You told {props.botName} ({decision.noteTitle})
                  </small>
                  <strong>{decision.ownerSays}</strong>
                </div>
                {failed === decision.id && (
                  <small className="sourceProblem">
                    That didn’t save. Try again.
                  </small>
                )}
              </div>
              {props.canEdit && (
                <div className="decisionActions">
                  <button
                    type="button"
                    className="teachButton"
                    disabled={props.disabled || pending}
                    onClick={() => void choose(decision, 'useWebsite')}
                  >
                    Use the website
                  </button>
                  <button
                    type="button"
                    className="teachButton"
                    disabled={props.disabled || pending}
                    onClick={() => void choose(decision, 'keep')}
                  >
                    Keep mine
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

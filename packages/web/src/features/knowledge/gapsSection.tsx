import { MessageCircleReply, X } from 'lucide-react'
import { useState } from 'react'
import { formatWhen } from '../workspace/formatWhen'
import type { iKnowledgeGap } from '../workspace/types'

const shown = 3

interface iGapsProps {
  gaps: iKnowledgeGap[]
  botName: string
  canEdit: boolean
  disabled: boolean
  onAnswer: (gap: iKnowledgeGap) => void
  onDismiss: (gap: iKnowledgeGap) => void
}

function meta(gap: iKnowledgeGap) {
  const times = gap.askCount === 1 ? 'Asked once' : `Asked ${gap.askCount}×`
  return gap.lastAskedAt
    ? `${times} · last ${formatWhen(gap.lastAskedAt)}`
    : times
}

// Questions real visitors asked that the bot couldn't answer. Each closes
// itself once the bot's knowledge answers it; with none, nothing shows.
export function GapsSection(props: iGapsProps) {
  const [all, setAll] = useState(false)
  const [answering, setAnswering] = useState<string[]>([])
  if (!props.gaps.length) return null
  const visible = all ? props.gaps : props.gaps.slice(0, shown)
  return (
    <section className="knowledgeSection gapsSection" aria-labelledby="gaps">
      <div className="knowledgeSectionHead">
        <h2 id="gaps">
          <span className="gapsDot" aria-hidden="true" />
          Questions {props.botName} couldn’t answer
          <span className="knowledgeCount">{props.gaps.length}</span>
        </h2>
        <p>Visitors asked these. Answer once and it’s used every time.</p>
      </div>
      <ul className="gapList">
        {visible.map((gap) => {
          const pending = answering.includes(gap.id)
          return (
            <li key={gap.id} className={pending ? 'is-pending' : ''}>
              <div className="gapText">
                <strong>{gap.question}</strong>
                <small>
                  {pending
                    ? 'Answering in chat. This clears once it’s learned.'
                    : meta(gap)}
                </small>
              </div>
              {props.canEdit && !pending && (
                <>
                  <button
                    type="button"
                    className="teachButton"
                    disabled={props.disabled}
                    title={`Tell ${props.botName} the answer`}
                    onClick={() => {
                      setAnswering((items) => [...items, gap.id])
                      props.onAnswer(gap)
                    }}
                  >
                    <MessageCircleReply size={13} /> Answer
                  </button>
                  <button
                    type="button"
                    className="gapDismiss"
                    aria-label={`Not relevant: ${gap.question}`}
                    title="Not relevant to my business"
                    onClick={() => props.onDismiss(gap)}
                  >
                    <X size={13} />
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {props.gaps.length > shown && (
        <button
          type="button"
          className="textButton"
          onClick={() => setAll(!all)}
        >
          {all ? 'Show fewer' : `Show ${props.gaps.length - shown} more`}
        </button>
      )}
    </section>
  )
}

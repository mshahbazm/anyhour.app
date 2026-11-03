import { X } from 'lucide-react'
import type { iKnowledgeSource } from '../workspace/types'

interface iSkippedRow {
  key: string
  title: string
  detail: string | null
  rules: string[]
}

const kindWords = {
  article: 'article',
  listing: 'list',
  language: 'other-language',
} as const
type tSkippedKind = keyof typeof kindWords
const pagesLabel = (count: number, kind: tSkippedKind) =>
  `Skipped ${count.toLocaleString('en-US')} ${kindWords[kind]} page${count === 1 ? '' : 's'}`
// "/my-post$" means that page only.
const ruleLabel = (rule: string) => rule.replace(/\$$/, '')

// A website's exclude rules: those added before its first read say how many
// pages they skip; single pages skipped together share one line.
function skippedRows(source: iKnowledgeSource): iSkippedRow[] {
  const rules = source.excludePaths ?? []
  const planned = new Map(
    (source.scopePlan?.rules ?? []).map((item) => [item.rule, item]),
  )
  const rows: iSkippedRow[] = []
  const singles = {
    article: [] as string[],
    listing: [] as string[],
    language: [] as string[],
  }
  const singlePages = { article: 0, listing: 0, language: 0 }
  for (const rule of rules) {
    const plan = planned.get(rule)
    if (plan && rule.endsWith('$')) {
      singles[plan.kind].push(rule)
      singlePages[plan.kind] += plan.pages
    } else
      rows.push({
        key: rule,
        title: plan ? pagesLabel(plan.pages, plan.kind) : ruleLabel(rule),
        detail: plan ? ruleLabel(rule) : null,
        rules: [rule],
      })
  }
  for (const kind of ['article', 'listing', 'language'] as const)
    if (singles[kind].length)
      rows.push({
        key: `single-${kind}`,
        title: pagesLabel(singlePages[kind], kind),
        detail:
          singles[kind].slice(0, 3).map(ruleLabel).join(', ') +
          (singles[kind].length > 3 ? '…' : ''),
        rules: singles[kind],
      })
  return rows
}

interface iSkippedPathsProps {
  source: iKnowledgeSource
  canEdit: boolean
  disabled: boolean
  onRemove: (excludePaths: string[]) => void
}

export function SkippedPaths(props: iSkippedPathsProps) {
  const rows = skippedRows(props.source)
  if (!rows.length) return null
  return (
    <div className="detailSection">
      <h4>Skipped</h4>
      <ul className="gapList">
        {rows.map((row) => (
          <li key={row.key}>
            <div className="gapText">
              <strong>{row.title}</strong>
              {row.detail && <small>{row.detail}</small>}
            </div>
            {props.canEdit && (
              <button
                type="button"
                className="gapDismiss"
                aria-label={`Read again: ${row.title}`}
                title="Read these pages"
                disabled={props.disabled}
                onClick={() =>
                  props.onRemove(
                    (props.source.excludePaths ?? []).filter(
                      (rule) => !row.rules.includes(rule),
                    ),
                  )
                }
              >
                <X size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

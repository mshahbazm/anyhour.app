import { StatusPill } from '../leads/status'
import { formatWhen } from '../workspace/formatWhen'
import type { iContactDeal } from './types'
import { roleLabels } from './types'

// A lead a contact is on: what it is, where it stands, and their part in it.
export function DealRow(props: { deal: iContactDeal; onOpen: () => void }) {
  const { deal } = props
  const meta = [roleLabels[deal.role], formatWhen(deal.createdAt)]
  return (
    <li>
      <button type="button" className="dealRow" onClick={props.onOpen}>
        <span className="dealText">
          <strong>{deal.title}</strong>
          <small>{meta.join(' · ')}</small>
        </span>
        <StatusPill status={deal.status} />
      </button>
    </li>
  )
}

// Where a lead stands. New and contacted are open; won and lost are closed.
export const leadStatuses = ['new', 'contacted', 'won', 'lost'] as const
export type tLeadStatus = (typeof leadStatuses)[number]

export const statusLabels: Record<tLeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  won: 'Won',
  lost: 'Lost',
}

const statusTones: Record<tLeadStatus, string> = {
  new: 'var(--accent-brand)',
  contacted: 'var(--warning)',
  won: 'var(--success)',
  lost: 'var(--subtle-foreground)',
}

// A lead's value is kept in minor units (cents); there is no currency yet.
export function formatLeadValue(minor: number) {
  return (minor / 100).toLocaleString(undefined, {
    minimumFractionDigits: minor % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })
}

export function StatusDot({ status }: { status: tLeadStatus }) {
  return (
    <span
      className="statusDot"
      style={{ background: statusTones[status] }}
      aria-hidden="true"
    />
  )
}

// A status in its colour (styled by .leadStatus).
export function StatusPill({ status }: { status: tLeadStatus }) {
  const tone = statusTones[status]
  return (
    <span
      className="leadStatus"
      style={{
        color: tone,
        background: `color-mix(in srgb, ${tone} 13%, transparent)`,
      }}
    >
      {statusLabels[status]}
    </span>
  )
}

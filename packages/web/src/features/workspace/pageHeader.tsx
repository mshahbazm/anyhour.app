import type { ReactNode } from 'react'

export function PageHeader({
  icon,
  title,
  description,
  actions,
}: {
  icon: ReactNode
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <header className="pageHeader">
      <span className="pageHeaderIcon" aria-hidden="true">
        {icon}
      </span>
      <div className="pageHeaderText">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="pageHeaderActions">{actions}</div>}
    </header>
  )
}

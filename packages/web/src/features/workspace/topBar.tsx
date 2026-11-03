import type { ReactNode } from 'react'

interface iTopBarProps {
  navigation?: ReactNode
  page: string
  actions?: ReactNode
}

// One header for the business's pages: where you are and what you can do here.
export function TopBar(props: iTopBarProps) {
  return (
    <header className="topBar">
      {props.navigation}
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <ol>
          <li aria-current="page" className="crumbPage">
            {props.page}
          </li>
        </ol>
      </nav>
      {props.actions && <div className="topBarActions">{props.actions}</div>}
    </header>
  )
}

import { Link } from '@tanstack/react-router'
import {
  Building2,
  ChevronsUpDown,
  ListChecks,
  LogOut,
  MessageSquareText,
  MessagesSquare,
  PanelLeft,
  Radio,
  Settings,
  Target,
  Users,
} from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdownMenu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { BotAvatar } from '../bots/botAvatar'
import { isAiView, viewPaths } from './paths'
import type { iAssistant, tWorkspaceView } from './types'
import './sidebar.css'

interface iAppSidebarProps {
  name: string
  email: string
  organizationId: string | null
  workspaceName: string | null
  /** The workspace's AI; undefined before sign-up made it. */
  bot: iAssistant | undefined
  canEdit: boolean
  /** Icon-only rail on wide screens. */
  collapsed?: boolean
  knowledgeCount: number
  indexing: boolean
  newLeads: number
  /** Conversations waiting for the team: the inbox badge. */
  inboxNeedsYou: number
  /** The open page, so the AI's chat stays marked on its Profile too. */
  view: tWorkspaceView
  /** Website changes that disagree with a fact in Your business. */
  businessDecisions: number
  /** Called after any page link is followed, so a drawer can close. */
  onNavigate: () => void
  onWorkspaceSettings: () => void
  onToggle: () => void
  toggleLabel: string
  onSignOut: () => void
}

// In the collapsed rail every control explains itself with a tooltip.
function Hint(props: {
  collapsed: boolean
  label: string
  children: ReactElement
}) {
  if (!props.collapsed) return props.children
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipContent side="right" sideOffset={10}>
        {props.label}
      </TooltipContent>
    </Tooltip>
  )
}

function NavItem(props: {
  collapsed: boolean
  icon: ReactNode
  label: string
  /** Rail tooltip when it should say more than the label. */
  hint?: string
  view: keyof typeof viewPaths
  disabled?: boolean
  trailing?: ReactNode
  /** Marks the icon too, so the collapsed rail still shows it. */
  alert?: 'new' | 'warning' | false
  /** Marked as the current page on another address too. */
  current?: boolean
  onNavigate: () => void
}) {
  const to = viewPaths[props.view]
  return (
    <Hint collapsed={props.collapsed} label={props.hint ?? props.label}>
      <Link
        to={to}
        // The chat lives at the root, so only its exact address marks it.
        activeOptions={{ exact: to === '/' }}
        className="navItem"
        aria-label={props.collapsed ? (props.hint ?? props.label) : undefined}
        disabled={props.disabled}
        aria-disabled={props.disabled || undefined}
        aria-current={props.current ? 'page' : undefined}
        onClick={props.onNavigate}
      >
        <span className="navIcon">
          {props.icon}
          {props.alert && (
            <span className={`navAlert is-${props.alert}`} aria-hidden="true" />
          )}
        </span>
        <span className="navLabel">{props.label}</span>
        {props.trailing && (
          <span className="navTrailing">{props.trailing}</span>
        )}
      </Link>
    </Hint>
  )
}

export function AppSidebar(props: iAppSidebarProps) {
  const ai = props.bot
  const collapsed = Boolean(props.collapsed)
  return (
    <TooltipProvider delay={200}>
      <nav
        className={`appSidebar ${collapsed ? 'is-collapsed' : ''}`}
        aria-label="Main navigation"
      >
        <div className="sidebarHeader">
          <Link
            to="/"
            className="sidebarBrand"
            aria-label="Home: this month"
            onClick={props.onNavigate}
          >
            <span className="brandMark" aria-hidden="true">
              W<span>+</span>
            </span>
            <span className="sidebarBrandText">
              <strong>Anyhour</strong>
              {props.workspaceName && <small>{props.workspaceName}</small>}
            </span>
          </Link>
          <button
            type="button"
            className="iconButton sidebarToggle"
            aria-label={props.toggleLabel}
            onClick={props.onToggle}
          >
            <PanelLeft size={16} />
          </button>
        </div>

        <div className="navGroup">
          {/* The AI's chat is the front page; then what it brings in. */}
          <NavItem
            collapsed={collapsed}
            icon={
              ai ? (
                <BotAvatar
                  bot={ai}
                  organizationId={props.organizationId}
                  size={18}
                />
              ) : (
                <MessageSquareText size={16} />
              )
            }
            label={ai ? `Chat with ${ai.name}` : 'Get started'}
            view="assistant"
            current={isAiView(props.view)}
            onNavigate={props.onNavigate}
          />
          <NavItem
            collapsed={collapsed}
            icon={<Target size={16} />}
            label="Leads"
            hint={props.newLeads > 0 ? 'Leads · new ones waiting' : undefined}
            view="leads"
            disabled={!ai}
            // New ones show as a dot, so the sidebar never disagrees with the
            // lists on the page.
            alert={props.newLeads > 0 && 'new'}
            onNavigate={props.onNavigate}
          />
          <NavItem
            collapsed={collapsed}
            icon={<MessagesSquare size={16} />}
            label="Inbox"
            hint={
              props.inboxNeedsYou > 0
                ? `Inbox · ${props.inboxNeedsYou} need${props.inboxNeedsYou === 1 ? 's' : ''} you`
                : undefined
            }
            view="conversations"
            disabled={!ai}
            alert={props.inboxNeedsYou > 0 && 'warning'}
            onNavigate={props.onNavigate}
            trailing={
              props.inboxNeedsYou > 0 ? (
                <span
                  className="navBadge is-warning"
                  aria-label={`${props.inboxNeedsYou} ${props.inboxNeedsYou === 1 ? 'conversation needs' : 'conversations need'} you`}
                  title="Needs you"
                >
                  {props.inboxNeedsYou}
                </span>
              ) : null
            }
          />
          <NavItem
            collapsed={collapsed}
            icon={<Users size={16} />}
            label="Contacts"
            view="contacts"
            disabled={!ai}
            onNavigate={props.onNavigate}
          />
        </div>

        <div className="navGroup">
          {/* What shapes the AI: what it knows, how it behaves, where. */}
          <span className="navGroupLabel">Setup</span>
          <NavItem
            collapsed={collapsed}
            icon={<Building2 size={16} />}
            label="Your business"
            hint={ai ? `Your business · what ${ai.name} knows` : undefined}
            view="business"
            disabled={!props.organizationId}
            alert={props.businessDecisions > 0 && 'warning'}
            onNavigate={props.onNavigate}
            trailing={
              props.businessDecisions > 0 ? (
                <span
                  className="navBadge is-warning"
                  aria-label={`${props.businessDecisions} website ${props.businessDecisions === 1 ? 'change needs' : 'changes need'} you`}
                  title="Website changes that need you"
                >
                  {props.businessDecisions}
                </span>
              ) : props.indexing ? (
                <span className="pulseDot" aria-label="Reading in progress" />
              ) : (
                <span className="navCount">{props.knowledgeCount}</span>
              )
            }
          />
          <NavItem
            collapsed={collapsed}
            icon={<ListChecks size={16} />}
            label="Rules"
            view="rules"
            disabled={!ai}
            onNavigate={props.onNavigate}
          />
          <NavItem
            collapsed={collapsed}
            icon={<Radio size={16} />}
            label="Channels"
            view="channels"
            disabled={!ai}
            onNavigate={props.onNavigate}
          />
        </div>

        <div className="sidebarFooter">
          <DropdownMenu>
            <Hint collapsed={collapsed} label={props.name || props.email}>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="accountButton"
                    aria-label="Account menu"
                  />
                }
              >
                <span className="accountAvatar" aria-hidden="true">
                  {(props.name || props.email).slice(0, 1).toUpperCase()}
                </span>
                <span className="accountIdentity">
                  <strong>{props.name || 'Your account'}</strong>
                  <small>{props.email}</small>
                </span>
                <ChevronsUpDown size={14} className="switcherChevron" />
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent
              side={collapsed ? 'right' : 'top'}
              align="start"
              className="min-w-56"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel>{props.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {props.canEdit && props.organizationId && (
                  <DropdownMenuItem onClick={props.onWorkspaceSettings}>
                    <Settings />
                    Workspace settings
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={props.onSignOut}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>
    </TooltipProvider>
  )
}

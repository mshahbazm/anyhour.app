import { useLocation, useNavigate } from '@tanstack/react-router'
import { PanelLeft, PanelRightOpen, Upload } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { Sheet, SheetContent, SheetTitle } from '#/components/ui/sheet'
import { Skeleton } from '#/components/ui/skeleton'
import { authClient } from '../auth/authClient'
import { AiHeader } from '../bots/aiHeader'
import { ProfilePage } from '../bots/profilePage'
import { ContactsPage } from '../contacts/contactsPage'
import { InboxPage } from '../conversations/inboxPage'
import { RulesPage } from '../memberRules/rulesPage'
import { useMemberRules } from '../memberRules/api'
import { actOnRuleDraft } from '../memberRules/ruleDraftCard'
import { useWorkspaceProfile } from '../onboarding/api'
import { OnboardingPage } from '../onboarding/onboardingPage'
import { WorkspaceSettingsDialog } from '../onboarding/workspaceSettingsDialog'
import { KnowledgePage } from '../knowledge/knowledgePage'
import {
  BusinessProfileCard,
  useBusinessProfile,
} from '../knowledge/businessCards'
import {
  uploadFiles,
  uploadProblem,
  uploadTypesLabel,
  useKnowledge,
  validateUpload,
} from '../knowledge/useKnowledge'
import { useAttention } from '../conversations/attention'
import { LeadsPage } from '../leads/leadsPage'
import { ChannelsPage } from '../channels/channelsPage'
import { useChannels } from '../channels/useChannels'
import { useMonthStats } from '../briefing/api'
import { worksOnSummary } from '../channels/api'
import { useWhatsappAgents } from '../channels/whatsappLink'
import type { iConnectionList } from '../channels/api'
import { ChannelPanel } from '../channels/panel/channelPanel'
import {
  aiChannels,
  panelButtonLabel,
  panelFromHash,
} from '../channels/panel/panelView'
import type { iPanelView, tPanelHash } from '../channels/panel/panelView'
import { useInstalls } from '../install/useInstalls'
import { useKnowledgeGaps } from '../knowledge/useKnowledgeGaps'
import { useWebsiteDecisions } from '../knowledge/useWebsiteDecisions'
import { AppSidebar } from './appSidebar'
import { ChatThread } from './chatThread'
import { TopBar } from './topBar'
import { Composer } from './composer'
import { useBotActivity } from './useBotActivity'
import { assistantBase, useWorkspace } from './useWorkspace'
import { Welcome } from './welcome'
import { gapTip, trainingTips, useUsedTips } from './trainingTips'
import type { iTrainingTip } from './trainingTips'
import type { tGreeting } from './welcome'
import { readWorkspaceSession, saveWorkspaceSession } from './workspaceSession'
import { isAiView, viewPaths } from './paths'
import { blockOptions } from './types'
import type { iAssistant, tWorkspaceView } from './types'
import './workspace.css'
import './pages.css'
import './sidebar.css'

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}

interface iWorkspacePageProps {
  name: string
  email: string
  view: tWorkspaceView
  /** The knowledge source, conversation or lead open from the address. */
  sourceId: string | null
  conversationId: string | null
  leadId: string | null
  contactId: string | null
}

export function WorkspacePage({
  name,
  email,
  view,
  sourceId,
  conversationId,
  leadId,
  contactId,
}: iWorkspacePageProps) {
  const navigate = useNavigate()
  // A link can open the channel panel on one view (#website-install).
  const hash = useLocation({ select: (location) => location.hash })
  // The channel panel beside the AI's chat: on wide screens a column, open
  // by default and remembered per browser; on smaller ones a sheet, only
  // when asked. With no channel it starts closed.
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      return localStorage.getItem('anyhour:panel') !== '0'
    } catch {
      return true
    }
  })
  const [addOpen, setAddOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [panelView, setPanelView] = useState<iPanelView>({
    channelId: null,
    website: 'preview',
  })
  // Icon-only sidebar on wide screens, remembered per browser.
  const [railed, setRailed] = useState(() => {
    try {
      return localStorage.getItem('anyhour:rail') === '1'
    } catch {
      return false
    }
  })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The workspace exists but onboarding's last steps are still showing.
  const [settingUp, setSettingUp] = useState(false)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [greeting, setGreeting] = useState<tGreeting | null>(null)
  // The conversation whose draft and greeting are currently loaded.
  const [restoredChat, setRestoredChat] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const composerInput = useRef<HTMLTextAreaElement>(null)
  const navigationToggle = useRef<HTMLButtonElement>(null)
  const panelToggle = useRef<HTMLButtonElement>(null)
  const refreshKnowledge = useRef<() => void>(() => undefined)
  const wideSidebar = useMedia('(min-width: 900px)')
  const widePanel = useMedia('(min-width: 1200px)')

  const workspace = useWorkspace(email, {
    onSource: (id) => openSource(id),
    onKnowledgeChanged: () => refreshKnowledge.current(),
  })
  const { chat, assistant, busy, loading, setError } = workspace
  const organizationId = workspace.organizationId
  // The workspace's AI: its chat, Profile and Rules sit under its header.
  const aiView = isAiView(view) ? view : null
  const base = assistantBase(chat)
  const reportError = useCallback(
    (message: string) => setError(message),
    [setError],
  )
  // Your business: what the AI reads.
  const businessBase = organizationId
    ? `/api/organizations/${organizationId}/business`
    : null
  const knowledge = useKnowledge(businessBase, reportError)
  const knowledgeGaps = useKnowledgeGaps(base)
  const websiteDecisions = useWebsiteDecisions(businessBase)
  const businessProfile = useBusinessProfile(
    view === 'business' ? businessBase : null,
    `${knowledge.sources.length}:${knowledge.indexing}`,
  )
  const workspaceProfile = useWorkspaceProfile(
    organizationId,
    workspace.canEdit,
  )
  refreshKnowledge.current = () => {
    void knowledge.refresh().catch(() => undefined)
    // A chat decision or a saved fact can settle a website change.
    void websiteDecisions.refresh().catch(() => undefined)
  }
  const refreshGaps = knowledgeGaps.refresh
  const refreshDecisions = websiteDecisions.refresh
  // Once reading finishes, the AI rebuilds its overview in the background.
  const indexing = knowledge.indexing
  const refreshAssistant = workspace.refreshAssistant
  const wasIndexing = useRef(indexing)
  useEffect(() => {
    const finished = wasIndexing.current && !indexing
    wasIndexing.current = indexing
    if (!finished) return
    const timer = window.setTimeout(() => {
      void refreshAssistant()
      void refreshGaps().catch(() => undefined)
      // Changed pages are compared with the owner's facts in the same job.
      void refreshDecisions().catch(() => undefined)
    }, 70_000)
    return () => window.clearTimeout(timer)
  }, [indexing, refreshAssistant, refreshGaps, refreshDecisions])
  const { activity, refresh: refreshActivity } = useBotActivity(
    organizationId,
    chat?.assistantId ?? null,
  )
  const monthStats = useMonthStats(
    view === 'assistant' ? organizationId : null,
    assistant?.tracking ?? false,
  )
  // One Needs-you count for the whole workspace, so the sidebar and the
  // inbox agree.
  const attention = useAttention(organizationId)
  // The business's channels, and where customers reach the AI.
  const channels = useChannels(organizationId)
  const refreshChannels = channels.refresh
  const ownChannels = aiChannels(channels.list)
  // The person's own WhatsApp agents, for Channels.
  const whatsapp = useWhatsappAgents(organizationId)
  const hasPanelContent = ownChannels.length > 0
  const hasWebsite = ownChannels.some((item) => item.provider === 'website')
  // The panel sits beside the chat only. With no channel it offers to set
  // one up, which only owners and admins can act on.
  const panelShown =
    view === 'assistant' &&
    Boolean(assistant && organizationId && channels.list) &&
    (hasPanelContent || workspace.canEdit)
  const sideOpen = widePanel
    ? hasPanelContent
      ? panelOpen
      : addOpen
    : sheetOpen
  function showPanel(open: boolean) {
    if (!widePanel) {
      setSheetOpen(open)
      return
    }
    // The button that reopens it appears in the header; keep focus there.
    if (!open) requestAnimationFrame(() => panelToggle.current?.focus())
    if (!hasPanelContent) {
      setAddOpen(open)
      return
    }
    setPanelOpen(open)
    try {
      localStorage.setItem('anyhour:panel', open ? '1' : '0')
    } catch {
      /* The preference is optional. */
    }
  }
  const panelChannel =
    ownChannels.find((item) => item.id === panelView.channelId) ??
    ownChannels.at(0)
  const openWebsite =
    panelShown && sideOpen && panelChannel?.provider === 'website'
  // Where its chat has really loaded, while the website view is open.
  const { installs } = useInstalls(
    organizationId,
    openWebsite ? assistant?.id : undefined,
  )
  // A removed website also leaves the AI's websites, so it reloads too.
  function changeChannels(list: iConnectionList) {
    channels.setList({
      available: list.available,
      connections: list.connections,
    })
    void refreshAssistant()
  }
  // The AI's websites are its Website chat channels.
  function changeWebsites(bot: iAssistant) {
    workspace.updateAssistant(bot)
    void refreshChannels()
  }

  // Restore the unsent draft and greeting for each conversation. This runs
  // before paint, so nothing typed can land before the restore and be lost.
  useLayoutEffect(() => {
    if (!chat || loading || restoredChat === chat.id) return
    setRestoredChat(chat.id)
    const saved = readWorkspaceSession(email, chat.organizationId, chat.id)
    setText(saved?.draft ?? '')
    setGreeting(saved?.greeting ?? null)
  }, [chat, loading, email, restoredChat])
  useEffect(() => {
    if (chat && !loading && restoredChat === chat.id)
      saveWorkspaceSession(email, chat.organizationId, {
        chatId: chat.id,
        draft: text,
        greeting: greeting ?? undefined,
      })
  }, [chat, loading, email, restoredChat, text, greeting])

  // Until a conversation's draft is restored, typing would be overwritten.
  const restored = !chat || restoredChat === chat.id
  const disabled = loading || busy || uploading || !restored
  const knowledgeKnown = !base || knowledge.loaded

  // The briefing follows the last message there was when the chat opened,
  // so it's the newest thing in view and the conversation carries on below.
  const [openedAt, setOpenedAt] = useState<{
    chatId: string
    after: string | null
    count: number
  } | null>(null)
  useEffect(() => {
    if (!chat || loading || openedAt?.chatId === chat.id) return
    setOpenedAt({
      chatId: chat.id,
      after: workspace.messages.at(-1)?.id ?? null,
      count: workspace.messages.length,
    })
  }, [chat, loading, openedAt, workspace.messages])
  const opened = chat && openedAt?.chatId === chat.id ? openedAt : null

  // The opening greeting is chosen once per conversation so it doesn't change mid-chat.
  useEffect(() => {
    if (!chat || loading || greeting || restoredChat !== chat.id) return
    if (!knowledgeKnown) return
    const learning = !base || !knowledge.sources.length || knowledge.indexing
    setGreeting(workspace.canEdit && learning ? 'ready' : 'return')
  }, [
    chat,
    loading,
    greeting,
    restoredChat,
    knowledgeKnown,
    base,
    knowledge.sources.length,
    knowledge.indexing,
    workspace.canEdit,
  ])

  // Before the first workspace, or while it has no AI: the sign-up
  // questions, which make the AI. Only owners and admins set it up.
  const settled = !loading && !workspace.error && workspace.context !== null
  const withoutAi =
    settled && Boolean(organizationId) && workspace.canEdit && !assistant
  const onboarding = settled && (!organizationId || withoutAi)

  // A link that names a panel view (#website-install) opens the panel there
  // once the channels are known, then leaves a clean address.
  const linkedView = panelShown ? panelFromHash(hash, ownChannels) : null
  const linkedKey = linkedView ? hash : null
  const linked = useRef({ view: linkedView, show: showPanel })
  linked.current = { view: linkedView, show: showPanel }
  useEffect(() => {
    const next = linked.current.view
    if (!linkedKey || !next) return
    setPanelView(next)
    linked.current.show(true)
    void navigate({ to: '/', replace: true })
  }, [linkedKey, navigate])

  async function upload(target: string, list: File[]) {
    setUploading(true)
    try {
      const report = await uploadFiles(target, list)
      if (report.added.length) await knowledge.refresh()
      return report
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    const message = text.trim()
    const attached = files
    if (disabled || (!message && !attached.length)) return
    const problem = attached.map(validateUpload).find(Boolean)
    if (problem) {
      setError(problem)
      return
    }
    setText('')
    setFiles([])
    try {
      if (!attached.length) {
        await workspace.send(message)
        return
      }
      // Files in the chat go to Your business.
      if (!base || !businessBase) {
        setFiles(attached)
        setError('Your AI isn’t set up yet.')
        return
      }
      const report = await upload(businessBase, attached)
      const leftOut = uploadProblem(report)
      if (leftOut) setError(leftOut)
      // Only what was actually added is mentioned to the bot.
      const note =
        report.added.length > 0 &&
        `I uploaded ${report.added.join(', ')} for you to learn from.`
      if (note || message)
        await workspace.send(
          note ? (message ? `${message}\n\n(${note})` : note) : message,
        )
    } catch (cause) {
      setFiles(attached)
      setError(cause instanceof Error ? cause.message : 'Upload failed')
    }
  }

  function attach(list: File[]) {
    if (!workspace.canEdit || !list.length) return
    setFiles((current) => [...current, ...list])
  }

  async function signOut() {
    const result = await authClient.signOut().catch(() => null)
    if (!result || result.error)
      setError('Could not sign out. Please try again.')
    else window.location.assign('/login')
  }

  const tryWebsite = hasWebsite ? () => openPanel('website') : null
  const sourceIds = new Set(knowledge.sources.map((source) => source.id))
  // Websites, pages and files; facts told in chat aren't sources.
  const rootCount = knowledge.sources.filter(
    (source) =>
      source.kind !== 'note' &&
      (!source.parentId || !sourceIds.has(source.parentId)),
  ).length
  const ready = knowledge.sources.filter(
    (source) =>
      source.status === 'ready' &&
      source.isIncluded &&
      !knowledge.sources.some((child) => child.parentId === source.id),
  ).length
  const botName = assistant?.name ?? null
  // Opens the chat with a draft in the composer, ready to edit and send:
  // how pages hand a request to the agent ("Change the rule …: ").
  function askBot(draft: string) {
    setText(draft)
    go('assistant')
  }
  // ⌘K (Ctrl K) anywhere, or / outside a text field, goes to the chat with
  // the cursor in the box: talking to the agent is never more than a key away.
  const viewRef = useRef(view)
  viewRef.current = view
  const goChat = useRef<() => void>(() => undefined)
  goChat.current = () => go('assistant')
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing =
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      const command =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
      const slash =
        event.key === '/' &&
        !typing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      if (!command && !slash) return
      // Leave a dialog or sheet that is open alone.
      if (document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      setDrawerOpen(false)
      if (viewRef.current !== 'assistant') goChat.current()
      requestAnimationFrame(() => composerInput.current?.focus())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  function openLead(id: string) {
    setDrawerOpen(false)
    void navigate({ to: '/leads/$leadId', params: { leadId: id } })
  }

  function go(next: keyof typeof viewPaths) {
    setDrawerOpen(false)
    void navigate({ to: viewPaths[next] })
  }
  // The AI's chat with the channel panel open on one view.
  function openPanel(panel: tPanelHash) {
    setDrawerOpen(false)
    void navigate({ to: '/', hash: panel })
  }
  function openContact(id: string | null) {
    void navigate(
      id
        ? { to: '/contacts/$contactId', params: { contactId: id } }
        : { to: '/contacts' },
    )
  }
  // A source the chat opens is shown on Your business.
  function openSource(id: string | null) {
    void navigate(
      id
        ? { to: '/business/$sourceId', params: { sourceId: id } }
        : { to: '/business' },
    )
  }
  function openConversation(id: string | null) {
    void navigate(
      id
        ? {
            to: '/conversations/$conversationId',
            params: { conversationId: id },
          }
        : { to: '/conversations' },
    )
  }

  const { used: usedTips, markUsed } = useUsedTips(assistant?.id ?? null)
  const tipRules = useMemberRules(workspace.canEdit ? organizationId : null)
  const tips = workspace.canEdit
    ? trainingTips({
        bot: assistant,
        // Until knowledge loads, don't suggest adding the first source.
        knowledgeCount: knowledge.loaded ? rootCount : 1,
        gaps: knowledgeGaps.gaps,
        ruleTags: tipRules.rules?.flatMap((rule) => rule.tag ?? []) ?? null,
      }).filter((tip) => !usedTips.has(tip.id))
    : []
  // A tip starts a teaching conversation with the bot, wherever it was tapped.
  function teach(tip: iTrainingTip) {
    markUsed(tip.id)
    if (view !== 'assistant') go('assistant')
    void workspace.send(tip.prompt)
  }

  const sidebar = (
    <AppSidebar
      name={name}
      email={email}
      organizationId={organizationId}
      workspaceName={workspace.organization?.name ?? null}
      bot={assistant}
      canEdit={workspace.canEdit}
      knowledgeCount={rootCount}
      indexing={knowledge.indexing}
      newLeads={activity?.newLeads ?? 0}
      inboxNeedsYou={attention.available ? attention.supportCount : 0}
      view={view}
      businessDecisions={websiteDecisions.decisions.length}
      onNavigate={() => setDrawerOpen(false)}
      onWorkspaceSettings={() => {
        setDrawerOpen(false)
        setSettingsOpen(true)
      }}
      collapsed={wideSidebar && railed}
      toggleLabel={
        !wideSidebar
          ? 'Close navigation'
          : railed
            ? 'Expand sidebar'
            : 'Collapse sidebar'
      }
      onToggle={() => {
        if (!wideSidebar) {
          setDrawerOpen(false)
          return
        }
        setRailed(!railed)
        try {
          localStorage.setItem('anyhour:rail', railed ? '0' : '1')
        } catch {
          /* The preference is optional. */
        }
      }}
      onSignOut={() => void signOut()}
    />
  )

  const businessView = (
    <KnowledgePage
      base={businessBase}
      organizationId={organizationId}
      assistantId={assistant?.id ?? null}
      botName={botName}
      knowledge={knowledge}
      canEdit={workspace.canEdit}
      selectedId={sourceId}
      onSelect={openSource}
      onUpload={async (list) => {
        if (!businessBase) return
        // The page shows this as its error, naming each file left out.
        const problem = uploadProblem(await upload(businessBase, list))
        if (problem) throw new Error(problem)
      }}
      intro={<BusinessProfileCard profile={businessProfile} />}
      disabled={disabled}
      decisions={websiteDecisions.decisions}
      onResolveDecision={async (decision, choice) => {
        await websiteDecisions.resolve(decision.id, choice)
        // Following the website rewrites (or removes) the owner's note.
        if (choice === 'useWebsite') refreshKnowledge.current()
      }}
      openingHours={businessProfile}
      gaps={knowledgeGaps.gaps}
      onAnswerGap={(gap) => teach(gapTip(gap))}
      onDismissGap={(gap) => void knowledgeGaps.dismiss(gap.id)}
    />
  )
  const knowledgeWebsites = knowledge.sources.flatMap((source) =>
    source.kind === 'website' && source.inputUrl ? [source.inputUrl] : [],
  )

  const navigationButton = !wideSidebar && (
    <button
      ref={navigationToggle}
      type="button"
      className="iconButton"
      aria-label="Open navigation"
      onClick={() => setDrawerOpen(true)}
    >
      <PanelLeft size={16} />
    </button>
  )
  const pageTitles: Record<tWorkspaceView, string> = {
    assistant: 'Chat',
    business: 'Your business',
    channels: 'Channels',
    profile: 'Profile',
    rules: 'Rules',
    conversations: 'Inbox',
    leads: 'Leads',
    contacts: 'Contacts',
  }
  // The AI's pages open under its header and tabs; the business's pages
  // under the top bar.
  const header = (actions?: ReactNode) =>
    aiView && assistant && organizationId ? (
      <AiHeader
        bot={assistant}
        organizationId={organizationId}
        view={aiView}
        worksOn={worksOnSummary(channels.list)}
        navigation={navigationButton}
        actions={actions}
      />
    ) : (
      <TopBar
        navigation={navigationButton}
        page={pageTitles[view]}
        actions={actions}
      />
    )

  // Offered while the panel is closed; the panel closes itself.
  const panelButton = panelShown && !sideOpen && (
    <button
      ref={panelToggle}
      type="button"
      className="panelOpenButton"
      aria-label={`Show ${panelButtonLabel(ownChannels)} panel`}
      onClick={() => showPanel(true)}
    >
      <PanelRightOpen size={15} />
      {panelButtonLabel(ownChannels)}
    </button>
  )
  const channelPanel = panelShown &&
    sideOpen &&
    assistant &&
    organizationId &&
    channels.list && (
      <ChannelPanel
        organizationId={organizationId}
        bot={assistant}
        canEdit={workspace.canEdit}
        channels={ownChannels}
        view={panelView}
        onView={setPanelView}
        onList={changeChannels}
        readySources={ready}
        knowledgeWebsites={knowledgeWebsites}
        installs={installs}
        onChanged={changeWebsites}
        onSource={openSource}
        onClose={() => showPanel(false)}
      />
    )

  if (onboarding || settingUp)
    return (
      <OnboardingPage
        firstName={name.split(' ')[0] ?? ''}
        account={email}
        organizationId={organizationId}
        onCreated={() => setSettingUp(true)}
        onDone={(orgId) => {
          // The AI's chat already holds its first message.
          setSettingUp(false)
          void navigate({ to: '/' })
          void workspace.openChat(orgId)
        }}
      />
    )

  return (
    <div className="app">
      {wideSidebar && sidebar}
      <Sheet open={drawerOpen && !wideSidebar} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          finalFocus={navigationToggle}
          className="drawerSheet is-left"
        >
          <SheetTitle className="sr-only">Main navigation</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <div className="shell">
        {view !== 'assistant' ? (
          <main className="insetPanel pageMain">
            {header()}
            <div className="pageScroll">
              {loading ? (
                <div className="page" role="status">
                  <Skeleton className="h-9 w-64" />
                  <Skeleton className="h-40 w-full rounded-2xl" />
                </div>
              ) : view === 'business' ? (
                businessView
              ) : view === 'channels' ? (
                <ChannelsPage
                  organizationId={organizationId}
                  bot={assistant}
                  canManage={workspace.canEdit}
                  list={channels.list}
                  onList={changeChannels}
                  onBotChanged={changeWebsites}
                  onInstall={() => openPanel('website-install')}
                  whatsapp={whatsapp}
                />
              ) : view === 'profile' ? (
                assistant &&
                organizationId && (
                  <ProfilePage
                    organizationId={organizationId}
                    bot={assistant}
                    canEdit={workspace.canEdit}
                    onChanged={workspace.updateAssistant}
                  />
                )
              ) : view === 'rules' ? (
                assistant &&
                organizationId && (
                  <RulesPage
                    key={assistant.id}
                    organizationId={organizationId}
                    bot={assistant}
                    canEdit={workspace.canEdit}
                  />
                )
              ) : view === 'contacts' ? (
                <ContactsPage
                  organizationId={organizationId}
                  bot={assistant}
                  canWork={workspace.canWorkLeads}
                  contactId={contactId}
                  onOpenContact={openContact}
                  onOpenLead={openLead}
                  onOpenConversation={openConversation}
                  onAsk={askBot}
                />
              ) : view === 'conversations' ? (
                <InboxPage
                  organizationId={organizationId}
                  botName={botName}
                  attention={attention}
                  canWork={workspace.canWorkLeads}
                  canEdit={workspace.canEdit}
                  selectedId={conversationId}
                  onSelect={openConversation}
                  onOpenContact={openContact}
                  onOpenLead={openLead}
                  onTry={tryWebsite}
                />
              ) : (
                <LeadsPage
                  organizationId={organizationId}
                  bot={assistant}
                  onTry={tryWebsite}
                  canWorkLeads={workspace.canWorkLeads}
                  openId={leadId}
                  onOpen={(id) =>
                    void navigate(
                      id
                        ? { to: '/leads/$leadId', params: { leadId: id } }
                        : { to: '/leads' },
                    )
                  }
                  onOpenConversation={openConversation}
                  onOpenContact={openContact}
                  onLeadsChanged={() => {
                    void refreshActivity().catch(() => undefined)
                    void attention.refresh()
                  }}
                />
              )}
            </div>
          </main>
        ) : (
          <main
            className="insetPanel chatMain"
            onDragEnter={(event) => {
              if (
                base &&
                workspace.canEdit &&
                event.dataTransfer.types.includes('Files')
              )
                setDragging(true)
            }}
            onDragOver={(event) => {
              if (dragging) event.preventDefault()
            }}
            onDragLeave={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setDragging(false)
            }}
            onDrop={(event) => {
              if (!dragging) return
              event.preventDefault()
              setDragging(false)
              attach(Array.from(event.dataTransfer.files))
            }}
          >
            {header(panelButton || undefined)}

            <div className="chatScroll">
              <div className="chatColumn">
                {loading ? (
                  <div className="threadLoading" role="status">
                    <span />
                    <span />
                    <span className="sr-only">Opening your workspace…</span>
                  </div>
                ) : (
                  <ChatThread
                    messages={workspace.messages}
                    blocks={workspace.blocks}
                    actions={workspace.actions}
                    busy={disabled}
                    bot={assistant}
                    organizationId={organizationId}
                    tips={tips.slice(0, 2)}
                    onTip={teach}
                    ruleDraft={{
                      canEdit: workspace.canEdit,
                      onAct: async (block, action) => {
                        if (!chat) return
                        workspace.replaceBlock(
                          await actOnRuleDraft(chat.id, block.id, action),
                        )
                      },
                      onOpen: () => void navigate({ to: '/rules' }),
                    }}
                    onRespond={(block, value) =>
                      void workspace.send(
                        `${'title' in block.payload ? block.payload.title : ''}: ${blockOptions(block).find((option) => option.value === value)?.label}`,
                        { blockId: block.id, value },
                      )
                    }
                    // A chat that opens on the AI's first stored message
                    // (just after sign-up) needs no local hello.
                    introAfter={opened?.after ?? null}
                    intro={
                      greeting &&
                      opened &&
                      !(
                        opened.count === 1 &&
                        workspace.messages[0]?.role === 'assistant'
                      ) && (
                        <Welcome
                          greeting={greeting}
                          business={workspace.organization?.name ?? null}
                          firstName={name.split(' ')[0] ?? ''}
                          organizationId={organizationId}
                          assistant={assistant}
                          active={workspace.messages.length === opened.count}
                          disabled={disabled}
                          activity={activity}
                          stats={monthStats.stats}
                          statsError={monthStats.error}
                          needsYou={
                            attention.available ? attention.supportCount : 0
                          }
                          canEdit={workspace.canEdit}
                          onBotChanged={workspace.updateAssistant}
                          onSend={(message) => void workspace.send(message)}
                          knowledgeCount={rootCount}
                          tip={tips[0]}
                          onTip={teach}
                        />
                      )
                    }
                  />
                )}
              </div>
            </div>

            <div className="chatFooter">
              <div className="chatColumn">
                {workspace.error && (
                  <div className="chatError" role="alert">
                    <span>{workspace.error}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setError('')
                        void workspace.openChat(organizationId)
                      }}
                    >
                      Reload
                    </button>
                    <button type="button" onClick={() => setError('')}>
                      Dismiss
                    </button>
                  </div>
                )}
                <Composer
                  value={text}
                  onValue={setText}
                  files={files}
                  onFiles={setFiles}
                  onSend={() => void submit()}
                  disabled={disabled}
                  canAttach={workspace.canEdit}
                  pickerRef={picker}
                  inputRef={composerInput}
                  placeholder={
                    uploading
                      ? 'Uploading documents…'
                      : busy
                        ? `${botName ?? 'Your AI'} is working on it…`
                        : `Message ${botName ?? 'your AI'}…`
                  }
                />
              </div>
            </div>

            {dragging && (
              <div className="dropOverlay" aria-hidden="true">
                <Upload size={22} />
                <strong>Drop to teach {botName ?? 'your AI'}</strong>
                <span>{uploadTypesLabel}· up to 10 MB each</span>
              </div>
            )}
          </main>
        )}
        {widePanel && channelPanel}
      </div>
      <Sheet
        open={Boolean(channelPanel) && !widePanel}
        onOpenChange={setSheetOpen}
      >
        <SheetContent
          showCloseButton={false}
          finalFocus={panelToggle}
          className="drawerSheet is-right"
        >
          <SheetTitle className="sr-only">
            {assistant ? `${assistant.name}’s channels` : 'Channels'}
          </SheetTitle>
          {channelPanel}
        </SheetContent>
      </Sheet>
      <WorkspaceSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        organizationId={organizationId}
        canManage={workspace.canEdit}
        profile={workspaceProfile.profile}
        onSaved={(profile) => {
          workspaceProfile.setProfile(profile)
          void refreshAssistant()
        }}
      />
    </div>
  )
}

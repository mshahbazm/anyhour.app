import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, apiResponse, readEvents } from './api'
import { readWorkspaceSession } from './workspaceSession'
import type {
  iAssistant,
  iChatBlock,
  iChatHistory,
  iWorkspaceAction,
  iWorkspaceChat,
  iWorkspaceContext,
  iWorkspaceMessage,
} from './types'

interface iWorkspaceCallbacks {
  onSource: (sourceId: string) => void
  onKnowledgeChanged: () => void
}

const knowledgeActions = new Set([
  'add_knowledge_note',
  'update_knowledge_note',
  'remove_knowledge_note',
  'add_source',
  'refresh_source',
  'set_source_included',
])

// Owns the signed-in workspace, its AI, the person's chat with it and its
// streaming turns.
export function useWorkspace(email: string, callbacks: iWorkspaceCallbacks) {
  const [context, setContext] = useState<iWorkspaceContext | null>(null)
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [chat, setChat] = useState<iWorkspaceChat | null>(null)
  const [assistant, setAssistant] = useState<iAssistant | null>(null)
  const [messages, setMessages] = useState<iWorkspaceMessage[]>([])
  const [blocks, setBlocks] = useState<iChatBlock[]>([])
  const [actions, setActions] = useState<iWorkspaceAction[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const activeChat = useRef<string | null>(null)
  const selection = useRef(0)
  const latest = useRef(callbacks)
  latest.current = callbacks

  const refreshWorkspace = useCallback(async (orgId: string) => {
    const [ai, nextContext] = await Promise.all([
      workspaceAi(orgId),
      api<iWorkspaceContext>('/api/workspace-agent/context'),
    ])
    setAssistant(ai)
    setContext(nextContext)
  }, [])

  // Re-reads the AI, e.g. to pick up an overview rebuilt in the background.
  const refreshAssistant = useCallback(async () => {
    if (organizationId)
      await refreshWorkspace(organizationId).catch(() => undefined)
  }, [organizationId, refreshWorkspace])

  const readChat = useCallback(
    async (id: string) => {
      const history = await api<iChatHistory>(
        `/api/workspace-agent/chats/${id}`,
      )
      if (activeChat.current !== id) return null
      setChat(history.chat)
      setOrganizationId(history.chat.organizationId)
      setMessages(history.messages)
      setActions(history.actions)
      setBlocks(history.blocks)
      setBusy(history.messages.some((message) => message.status === 'running'))
      if (history.chat.organizationId)
        await refreshWorkspace(history.chat.organizationId)
      return history
    },
    [refreshWorkspace],
  )

  const openChat = useCallback(
    async (orgId: string | null) => {
      const current = ++selection.current
      activeChat.current = null
      setLoading(true)
      setError('')
      setChat(null)
      setMessages([])
      setActions([])
      setBlocks([])
      setBusy(false)
      setOrganizationId(orgId)
      try {
        const ai = orgId ? await workspaceAi(orgId) : null
        if (selection.current !== current) return
        setAssistant(ai)
        // In a workspace with its AI: the person's one thread with it.
        // Before that: the chat last open, or a new one.
        const next =
          orgId && !ai
            ? null
            : orgId
              ? await openThread(orgId)
              : await lastChat(email)
        if (selection.current !== current) return
        if (!next) return
        activeChat.current = next.id
        await readChat(next.id)
      } catch (cause) {
        if (selection.current === current)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load the workspace',
          )
      } finally {
        if (selection.current === current) setLoading(false)
      }
    },
    [email, readChat],
  )

  useEffect(() => {
    let live = true
    void api<iWorkspaceContext>('/api/workspace-agent/context')
      .then(async (value) => {
        if (!live) return
        setContext(value)
        const saved = localStorage.getItem(`anyhour:workspace:${email}`)
        const orgId =
          value.organizations.find((org) => org.id === saved)?.id ??
          value.organizations.find(
            (org) => org.id === value.activeOrganizationId,
          )?.id ??
          (value.organizations.length ? value.organizations[0].id : null)
        await openChat(orgId)
      })
      .catch((cause) => {
        if (!live) return
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not load your account',
        )
        setLoading(false)
      })
    return () => {
      live = false
      selection.current++
      activeChat.current = null
    }
  }, [email, openChat])

  useEffect(() => {
    if (organizationId)
      localStorage.setItem(`anyhour:workspace:${email}`, organizationId)
  }, [organizationId, email])

  // A turn that outlived its stream (reload, closed tab) keeps running on the server.
  useEffect(() => {
    if (!busy || !chat) return
    const id = chat.id
    const interval = window.setInterval(() => {
      if (document.hidden) return
      void api<iChatHistory>(`/api/workspace-agent/chats/${id}`)
        .then((history) => {
          if (
            activeChat.current === id &&
            !history.messages.some((item) => item.status === 'running')
          ) {
            void readChat(id).catch(() => undefined)
            latest.current.onKnowledgeChanged()
          }
        })
        .catch(() => undefined)
    }, 4000)
    return () => clearInterval(interval)
  }, [busy, chat, readChat])

  async function send(
    content: string,
    blockResponse?: { blockId: string; value: string },
  ): Promise<iWorkspaceChat | null> {
    if (!chat || busy || loading || !content.trim()) return null
    const id = chat.id
    const clientMessageId = crypto.randomUUID()
    let replyId = `${clientMessageId}:reply`
    let streamFailure: string | null = null
    setError('')
    setBusy(true)
    setMessages((previous) => [
      ...previous,
      { id: clientMessageId, role: 'user', content, status: 'completed' },
      { id: replyId, role: 'assistant', content: '', status: 'running' },
    ])
    try {
      const response = await apiResponse(
        blockResponse
          ? `/api/workspace-agent/chats/${id}/blocks/${blockResponse.blockId}/respond`
          : `/api/workspace-agent/chats/${id}/messages`,
        {
          method: 'POST',
          body: JSON.stringify(
            blockResponse
              ? { value: blockResponse.value, clientMessageId }
              : { content, clientMessageId },
          ),
        },
      )
      await readEvents(response, (event, data) => {
        if (activeChat.current !== id) return
        if (event === 'started' && data.messageId) {
          const previousId = replyId
          replyId = data.messageId
          setMessages((previous) =>
            previous.map((item) =>
              item.id === previousId ? { ...item, id: replyId } : item,
            ),
          )
        }
        if (event === 'block' && data.block) {
          const block = data.block
          setBlocks((previous) => [
            ...previous.filter((item) => item.id !== block.id),
            block,
          ])
        }
        if (event === 'delta' && typeof data.text === 'string') {
          const text = data.text
          setMessages((previous) =>
            previous.map((item) =>
              item.id === replyId
                ? { ...item, content: item.content + text }
                : item,
            ),
          )
        }
        if (event === 'activity' && data.id && data.name && data.status) {
          const item = {
            id: data.id,
            name: data.name,
            status: data.status,
            messageId: replyId,
          }
          setActions((previous) => [
            ...previous.filter((action) => action.id !== item.id),
            item,
          ])
          if (item.status === 'completed' && knowledgeActions.has(item.name))
            latest.current.onKnowledgeChanged()
        }
        if (event === 'context' && typeof data.organizationId === 'string') {
          const nextOrg = data.organizationId
          setOrganizationId(nextOrg)
          setChat((previous) =>
            previous
              ? {
                  ...previous,
                  organizationId: nextOrg,
                  assistantId:
                    typeof data.assistantId === 'string'
                      ? data.assistantId
                      : null,
                }
              : previous,
          )
          void refreshWorkspace(nextOrg).catch(() => undefined)
        }
        if (event === 'source' && typeof data.sourceId === 'string')
          latest.current.onSource(data.sourceId)
        if (event === 'error')
          setError(data.message ?? 'The assistant could not finish this turn')
      })
    } catch (cause) {
      streamFailure =
        cause instanceof Error ? cause.message : 'Could not reach the assistant'
    }
    if (activeChat.current !== id) return null
    try {
      const saved = await readChat(id)
      latest.current.onKnowledgeChanged()
      // A dropped connection doesn't stop the reply: it keeps running on the
      // server and is saved. Only report a failure the saved state confirms.
      if (
        streamFailure &&
        saved &&
        !saved.messages.some((message) => message.status === 'running') &&
        saved.messages.find((message) => message.id === replyId)?.status !==
          'completed'
      )
        setError(streamFailure)
      return saved?.chat ?? null
    } catch (cause) {
      setBusy(false)
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not reload saved results',
      )
      return null
    }
  }

  const role = context?.organizations.find(
    (org) => org.id === organizationId,
  )?.role
  return {
    context,
    organizationId,
    organization: context?.organizations.find(
      (org) => org.id === organizationId,
    ),
    chat,
    assistant: assistant ?? undefined,
    messages,
    blocks,
    actions,
    loading,
    busy,
    error,
    setError,
    // Owners and admins set things up: the AI and knowledge.
    canEdit: role !== 'member',
    // Everyone in the workspace works its leads: statuses, notes.
    canWorkLeads: Boolean(role),
    send,
    openChat,
    refreshAssistant,
    // A card changed outside a turn (a tap on the rules card).
    replaceBlock: (block: iChatBlock) =>
      setBlocks((items) =>
        items.map((item) => (item.id === block.id ? block : item)),
      ),
    // Applies a change to the AI made outside the chat (profile, pictures).
    updateAssistant: (bot: iAssistant) =>
      setAssistant((current) => (current ? { ...current, ...bot } : bot)),
  }
}

// The workspace's AI, or null before sign-up made it.
async function workspaceAi(orgId: string) {
  try {
    return await api<iAssistant>(`/api/organizations/${orgId}/assistant`)
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'assistant_missing')
      return null
    throw cause
  }
}

// The person's one thread with the AI, shared with their WhatsApp and Slack.
function openThread(orgId: string) {
  return api<iWorkspaceChat>('/api/workspace-agent/chats', {
    method: 'POST',
    body: JSON.stringify({ organizationId: orgId }),
  })
}

// Without a workspace: the chat last open, the newest, or a new one.
async function lastChat(email: string) {
  const list = await api<iWorkspaceChat[]>('/api/workspace-agent/chats')
  const rememberedId = readWorkspaceSession(email, null)?.chatId
  return (
    list.find((item) => item.id === rememberedId) ??
    list.at(0) ??
    (await api<iWorkspaceChat>('/api/workspace-agent/chats', {
      method: 'POST',
      body: JSON.stringify({ organizationId: null }),
    }))
  )
}

export function assistantBase(chat: iWorkspaceChat | null) {
  return chat?.organizationId && chat.assistantId
    ? `/api/organizations/${chat.organizationId}/assistants/${chat.assistantId}`
    : null
}

import { useEffect, useRef, useState } from 'react'
import { BotChat } from '@anyhour/widget'
import type { iBlockAnswer, iBotMessage } from '@anyhour/widget'
import { api, apiResponse, readEvents } from '../workspace/api'
import { botPictureUrl } from '../bots/botAvatar'
import type { iAssistant } from '../workspace/types'

interface iTestChatProps {
  organizationId: string | null
  assistant: iAssistant | undefined
  ready: boolean
  onSource: (id: string) => void
  /** A starter question the owner tapped, sent once when it changes. */
  prompt?: { text: string; id: number } | null
  onClose?: () => void
}

// The owner's private test chat, through the preview API: no real leads.
export function TestChat({
  organizationId,
  assistant,
  ready,
  onSource,
  prompt,
  onClose,
}: iTestChatProps) {
  const [messages, setMessages] = useState<iBotMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const chatId = useRef<string | null>(null)
  const generation = useRef(0)
  const base =
    organizationId && assistant
      ? `/api/organizations/${organizationId}/assistants/${assistant.id}/preview/conversations`
      : null
  useEffect(() => {
    generation.current++
    chatId.current = null
    setMessages([])
    setError('')
    setBusy(false)
  }, [base])
  async function send(content: string, answer?: iBlockAnswer) {
    if (!base || busy) return
    const current = generation.current
    const clientMessageId = crypto.randomUUID()
    setBusy(true)
    setError('')
    setMessages((previous) => [
      ...previous,
      { id: clientMessageId, role: 'visitor', content },
      { id: `${clientMessageId}:reply`, role: 'assistant', content: '' },
    ])
    try {
      const id =
        chatId.current ??
        (await api<{ id: string }>(base, { method: 'POST', body: '{}' })).id
      if (generation.current !== current) return
      chatId.current = id
      const response = await apiResponse(`${base}/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content, clientMessageId, ...answer }),
      })
      await readEvents(response, (event, data) => {
        if (generation.current !== current) return
        if (event === 'delta' && typeof data.text === 'string')
          setMessages((previous) =>
            previous.map((item) =>
              item.id === `${clientMessageId}:reply`
                ? { ...item, content: item.content + data.text }
                : item,
            ),
          )
        if (event === 'done')
          setMessages((previous) =>
            previous.map((item) =>
              item.id === `${clientMessageId}:reply`
                ? { ...item, citations: data.citations }
                : item,
            ),
          )
        if (event === 'error')
          setError(
            'The preview response was interrupted. You can try a new message.',
          )
      })
    } catch (cause) {
      if (generation.current === current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not reach the preview',
        )
    } finally {
      if (generation.current === current) {
        if (chatId.current) {
          try {
            const saved = await api<{ messages: iBotMessage[] }>(
              `${base}/${chatId.current}`,
            )
            if (generation.current === current) setMessages(saved.messages)
          } catch {
            /* Keep the visible transcript and request error. */
          }
        }
        if (generation.current === current) setBusy(false)
      }
    }
  }
  // Tapping a starter question asks it, like on the website.
  const sentPrompt = useRef<number | null>(null)
  useEffect(() => {
    if (!prompt || !ready || sentPrompt.current === prompt.id) return
    sentPrompt.current = prompt.id
    void send(prompt.text)
  }, [prompt, ready])

  return (
    <BotChat
      onClose={onClose}
      name={assistant?.name ?? 'Your AI'}
      welcomeMessage={assistant?.welcomeMessage}
      avatarUrl={botPictureUrl(organizationId, assistant)}
      appearance={assistant?.appearance}
      messages={messages}
      busy={busy}
      disabled={!ready || !assistant}
      error={error}
      onSend={send}
      onCitation={onSource}
      onReset={() => {
        generation.current++
        chatId.current = null
        setMessages([])
        setError('')
        setBusy(false)
      }}
    />
  )
}

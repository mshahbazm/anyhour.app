import { Agent, Runner } from '@openai/agents'
import type { AgentInputItem } from '@openai/agents'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { workspaceAction, workspaceMessage } from '../../db/schema'
import { workspaceAgentConfig } from '../../config/workspaceAgent.config'
import { agentModel } from '../ai/llm'
import { ApiError } from '../http/apiError'
import {
  applyConfirmedAction,
  applyTappedConfirmation,
  buildWorkspaceTools,
} from './tools'
import type { tTeamChatApp } from '../../config/teamChat.config'
import { knowledgeChangesSinceChat } from './knowledgeChanges'
import { chatHistory, ownedChat } from './store'
import { loadBotFacts, loadWorkspaceFacts } from './promptFacts'
import { buildSystemPrompt } from './systemPrompt'
import type {
  tApiDispatch,
  tWorkspaceEvent,
} from '../../types/workspaceAgent.types'
import { startHeartbeat } from '../http/eventStream'

export function requireWorkspaceModel() {
  try {
    return agentModel('ownerAssistant')
  } catch (error) {
    if (error instanceof ApiError && error.code === 'ai_unconfigured')
      throw new ApiError(
        503,
        'ai_unconfigured',
        'The helper is not configured yet',
      )
    throw error
  }
}

export function workspaceAnswer(
  headers: Headers,
  dispatch: tApiDispatch,
  chatId: string,
  messageId: string,
  // From a chat app (services/teamChat): which one, and a listener for the
  // events the dashboard would get as a stream.
  options: {
    app?: tTeamChatApp
    listen?: (event: tWorkspaceEvent) => void
  } = {},
) {
  const abort = new AbortController()
  let connected = true
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    cancel() {
      connected = false
    },
    async start(controller) {
      const emit = (event: tWorkspaceEvent) => {
        options.listen?.(event)
        if (!connected) return
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            ),
          )
        } catch {
          connected = false
        }
      }
      const stopHeartbeat = startHeartbeat(controller, () => connected)
      let content = ''
      const timer = setTimeout(
        () => abort.abort(new Error('Generation deadline exceeded')),
        workspaceAgentConfig.timeoutMs,
      )
      const withinDeadline = <T>(promise: Promise<T>): Promise<T> =>
        new Promise((resolve, reject) => {
          const onAbort = () => reject(abort.signal.reason)
          abort.signal.addEventListener('abort', onAbort, { once: true })
          promise
            .then(resolve, reject)
            .finally(() => abort.signal.removeEventListener('abort', onAbort))
          if (abort.signal.aborted) onAbort()
        })
      try {
        emit({ type: 'started', messageId })
        const { messages, actions, blocks } = await chatHistory(chatId)
        const input: AgentInputItem[] = messages
          .filter((item) => item.id !== messageId)
          .slice(-24)
          .map((item) =>
            item.role === 'user'
              ? { role: 'user', content: item.content.slice(0, 8000) }
              : {
                  role: 'assistant',
                  status: 'completed',
                  content: [
                    {
                      type: 'output_text',
                      text:
                        item.content.slice(0, 8000) ||
                        'Previous response interrupted; inspect saved action outcomes.',
                    },
                  ],
                },
          )
        const toolContext = {
          headers,
          dispatch,
          chatId,
          messageId,
          signal: abort.signal,
          emit,
          app: options.app,
        }
        // A tapped "Use my new answer", or a confirmed action from a chat
        // app, is applied before the model runs.
        const confirmed =
          (await applyTappedConfirmation(toolContext)) ??
          (await applyConfirmedAction(toolContext))
        const outcomes = [
          ...actions.slice(-20).map((action) => ({
            name: action.name,
            status: action.status,
            result: action.result,
          })),
          ...(confirmed ? [{ ...confirmed, status: 'thisTurn' }] : []),
        ]
        const chat = await ownedChat(headers, chatId)
        const [bot, workspace] = await Promise.all([
          loadBotFacts(chat),
          loadWorkspaceFacts(chat),
        ])
        // Placed just before the owner's message: recency beats older replies.
        const changes = chat.organizationId
          ? await knowledgeChangesSinceChat(
              { organizationId: chat.organizationId },
              actions,
            )
          : []
        const latest = input.at(-1)
        if (
          changes.length &&
          latest &&
          'role' in latest &&
          latest.role === 'user'
        )
          input.splice(input.length - 1, 0, {
            role: 'system',
            content: `Knowledge changed outside this chat since these facts were saved here (the owner used the Your business page). This replaces what was said earlier in the chat; mention it only when relevant:\n${changes.join('\n')}`,
          })
        const helper = requireWorkspaceModel()
        const agent = new Agent({
          name: 'Anyhour helper',
          model: helper.model,
          modelSettings: { ...helper.modelSettings, parallelToolCalls: false },
          instructions: buildSystemPrompt({
            bot,
            workspace,
            app: options.app,
            recentChoices: blocks.slice(-12),
            recentOutcomes: outcomes,
          }),
          tools: buildWorkspaceTools(toolContext),
        })
        const result = await withinDeadline(
          new Runner({ tracingDisabled: true }).run(agent, input, {
            stream: true,
            maxTurns: workspaceAgentConfig.maxTurns,
            signal: abort.signal,
          }),
        )
        void result.completed.catch(() => undefined)
        const iterator = result.toTextStream()[Symbol.asyncIterator]()
        while (!abort.signal.aborted) {
          const next = await withinDeadline(iterator.next())
          if (next.done) break
          content += next.value
          emit({ type: 'delta', text: next.value })
        }
        await withinDeadline(result.completed)
        abort.signal.throwIfAborted()
        await db
          .update(workspaceMessage)
          .set({
            content,
            status: 'completed',
            completedAt: new Date(),
            model: helper.model,
            inputTokens: result.state.usage.inputTokens,
            outputTokens: result.state.usage.outputTokens,
          })
          .where(
            and(
              eq(workspaceMessage.id, messageId),
              eq(workspaceMessage.status, 'running'),
            ),
          )
        emit({ type: 'done', messageId })
      } catch (error) {
        // Log error classification only; provider messages can contain credentials or request data.
        const detail =
          error && typeof error === 'object'
            ? (error as { status?: unknown; code?: unknown; param?: unknown })
            : {}
        console.error('Workspace helper generation failed', {
          name: error instanceof Error ? error.name : 'UnknownError',
          status: typeof detail.status === 'number' ? detail.status : undefined,
          code: typeof detail.code === 'string' ? detail.code : undefined,
          param: typeof detail.param === 'string' ? detail.param : undefined,
        })
        const code = abort.signal.aborted
          ? 'generation_timeout'
          : 'agent_failed'
        await db
          .update(workspaceMessage)
          .set({
            content,
            status: 'failed',
            errorCode: code,
            completedAt: new Date(),
          })
          .where(eq(workspaceMessage.id, messageId))
        await db
          .update(workspaceAction)
          .set({ status: 'unknown' })
          .where(
            and(
              eq(workspaceAction.messageId, messageId),
              eq(workspaceAction.status, 'running'),
            ),
          )
        emit({
          type: 'error',
          code,
          message:
            'The helper stopped before finishing. Saved actions are shown below; check their results before retrying.',
        })
      } finally {
        clearTimeout(timer)
        stopHeartbeat()
        if (connected) {
          try {
            controller.close()
          } catch {
            /* disconnected */
          }
        }
      }
    },
  })
}

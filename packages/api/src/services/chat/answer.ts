import {
  agentModels,
  costUsd,
  languageModels,
} from '../../config/models.config'
import { agentModel } from '../ai/llm'
import { buildVisitorPrompt } from './visitorPrompt'
import { getBusinessProfile } from '../workspace/businessProfile'
import { Agent, run, tool } from '@openai/agents'
import type { AgentInputItem } from '@openai/agents'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db'
import { aiUsageEvent, assistant, conversation, message } from '../../db/schema'
import { chatConfig } from '../../config/chat.config'
import { failReply, type iReplyContext } from './messages'
import { visitorGreeting } from './greeting'
import { recordVisitorGap } from '../knowledge/gaps/knowledgeGaps'
import { env } from '../../env'
import { ApiError } from '../http/apiError'
import { createCitationSelection, visitorCitations } from './citations'
import { modelPassage } from './passages'
import { searchKnowledge } from '../knowledge/retrieval'
import {
  cachedSourceCatalogue,
  visitorCatalogueLines,
} from '../knowledge/catalogue'
import { captureChatLead } from '../leads/capture'
import { handOffConversation } from '../support/handoff'
import { startHeartbeat } from '../http/eventStream'
import { blockInputSchema } from '../../schemas/chatBlock.schema'
import type { tChatBlock } from '../../schemas/chatBlock.schema'
import { resolveBlock } from './blocks'
import { listMemberRules } from '../memberRules/rules'
import { knownWhatsappNumber } from '../whatsappQuestion/knownNumber'

export async function createAnswerStream(
  assistantId: string,
  conversationId: string,
  visitorMessageId: string,
  reply: iReplyContext,
  preview = false,
  channel: 'widget' | 'whatsapp' = 'widget',
) {
  const [record] = await db
    .select()
    .from(assistant)
    .where(eq(assistant.id, assistantId))
    .limit(1)
  if (!record)
    throw new ApiError(404, 'assistant_missing', 'Assistant not found')
  // Fails here, before anything streams, when the AI has no key.
  const model = agentModel('visitorChat')
  const abort = new AbortController()
  const evidence = createCitationSelection()
  const searchTool = tool({
    name: 'search_knowledge',
    description:
      'Search this business assistant’s indexed sources for facts, page purposes, and action links relevant to a visitor question. Include relevant conversation context in the question. Passages with origin "owner" are facts the owner told you directly and are current: they win over website passages. A passage marked "outdated" contradicts what the owner said; answer with ownerSays, never pageSaid.',
    parameters: z.object({ question: z.string().min(1) }),
    execute: async ({ question }) => {
      const passages = await searchKnowledge(
        assistantId,
        record.organizationId,
        conversationId,
        question,
        abort.signal,
      )
      evidence.register(passages)
      return passages.map(modelPassage)
    },
  })
  const citationTool = tool({
    name: 'cite_sources',
    description:
      'Select the retrieved source IDs actually used in your final answer. Call after searching and before answering. Pass an empty array if the evidence does not answer the question. Each call replaces the previous selection.',
    parameters: z.object({ sourceIds: z.array(z.string()).max(40) }),
    execute: async ({ sourceIds }) => evidence.select(sourceIds),
  })
  const captureTool = tool({
    name: 'capture_lead',
    description:
      'Record a visitor who wants the business to contact them, only after they explicitly provide an email or phone and agree to be contacted. reason "enquiry": they want to buy, book or get a quote. reason "question": you could not answer from the knowledge and they want a person to reply; put their question in the summary.',
    parameters: z.object({
      reason: z.enum(['enquiry', 'question']).optional(),
      title: z.string().min(1),
      summary: z.string().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
    }),
    execute: async (input) => {
      const captured = await captureChatLead(
        assistantId,
        conversationId,
        visitorMessageId,
        input,
        abort.signal,
      )
      return { leadId: captured.lead.id, status: 'saved' }
    },
  })
  // Every question the bot can't answer becomes a knowledge gap for the owner,
  // whether or not the visitor leaves contact details.
  const gapTool = tool({
    name: 'note_unanswered',
    description:
      "Quietly note a visitor question you couldn't answer from search, so the owner can teach you. Call it once per question, in the visitor's words, shortened to the question itself. The visitor never sees this.",
    parameters: z.object({ question: z.string().min(3).max(300) }),
    execute: async ({ question }) => {
      // Noting a gap must never cost the visitor their answer.
      await recordVisitorGap({
        organizationId: record.organizationId,
        assistantId,
        conversationId,
        question,
      }).catch((error) =>
        console.error(
          'Knowledge gap not recorded',
          error instanceof Error ? error.name : 'Unknown error',
        ),
      )
      return { status: 'noted' }
    },
  })
  // Passes the conversation to a person: needs-you, an owner alert and a
  // suggested reply. Live chats only.
  const handOffTool = tool({
    name: 'hand_off',
    description:
      'Pass this conversation to a person on the team. Use it when the visitor asks for a person, has a problem or complaint, money is involved (refunds, billing, payments), or you are not sure and they need someone. Write the summary for the team in your own words. Returns contactKnown: when false, ask for an email or phone so the team can reach them.',
    parameters: z.object({
      reason: z.enum(['asked_for_person', 'problem', 'not_sure', 'money']),
      wants: z
        .string()
        .min(1)
        .max(500)
        .describe('What the visitor wants, in one or two sentences.'),
      known: z
        .string()
        .max(500)
        .optional()
        .describe('What is known so far: order, dates, what they tried.'),
      nextStep: z
        .string()
        .max(300)
        .optional()
        .describe('A suggested next step for the team.'),
    }),
    execute: async (input) => {
      const handed = await handOffConversation({
        assistantId,
        conversationId,
        reason: input.reason,
        wants: input.wants,
        known: input.known,
        nextStep: input.nextStep,
      })
      return { status: 'handed_off', contactKnown: handed.contactKnown }
    },
  })
  // At most one block per reply: each call replaces the last. A block the
  // model gets wrong is refused here and the reply goes out as text.
  let block: tChatBlock | null = null
  const blocksTool = tool({
    name: 'send_blocks',
    description:
      'Show one tappable block under your reply: quick replies (choices), an option list (list), a checklist, a short contact form (contactForm), or the button that opens a chat with the business on WhatsApp (whatsapp; the number is filled in for you). Only when it makes answering easier. Still write your reply as normal text; the block appears beneath it. Each call replaces the previous block.',
    parameters: z.object({ block: blockInputSchema }),
    execute: async (input) => {
      const whatsappQuestion = Boolean(record.appearance.whatsapp)
      // Read at send time: the WhatsApp channel, else Your business.
      const whatsappNumber =
        input.block.kind === 'whatsapp' &&
        whatsappQuestion &&
        channel === 'widget'
          ? (await knownWhatsappNumber(record.organizationId)).number
          : null
      const resolved = resolveBlock(input.block, {
        channel,
        whatsappQuestion,
        whatsappNumber,
      })
      if (!resolved.ok) return { status: 'not_shown', reason: resolved.reason }
      block = resolved.block
      return { status: 'shown', visitorSees: resolved.block.fallback }
    },
  })
  const business = await getBusinessProfile(record.organizationId).catch(
    () => null,
  )
  const agent = new Agent({
    name: record.name,
    ...model,
    instructions: buildVisitorPrompt({
      botName: record.name,
      job: record.job,
      goal: record.goal,
      goalNotes: record.goalNotes,
      rules: await listMemberRules(record.organizationId),
      business,
      contactDetails: business?.contactDetails ?? null,
      overview: record.knowledgeOverview,
      sources: visitorCatalogueLines(
        await cachedSourceCatalogue({
          organizationId: record.organizationId,
        }),
      ),
      preview,
      channel,
      whatsappQuestion: record.appearance.whatsapp?.question ?? null,
    }),
    tools: preview
      ? [searchTool, citationTool, blocksTool]
      : [
          searchTool,
          citationTool,
          blocksTool,
          gapTool,
          captureTool,
          handOffTool,
        ],
  })
  // The visitor saw the greeting first, so the bot knows it already said hello.
  const opening: AgentInputItem = {
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: visitorGreeting(record) }],
  }
  const turns: AgentInputItem[] = reply.history.map((item) =>
    item.role === 'visitor'
      ? {
          role: 'user',
          content: [{ type: 'input_text', text: item.content }],
        }
      : {
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: item.content }],
        },
  )
  let content = ''
  let connected = true
  const timeout = setTimeout(
    () => abort.abort(new Error('Generation deadline exceeded')),
    chatConfig.generationTimeoutMs,
  )
  const encoder = new TextEncoder()
  const withinDeadline = <T>(promise: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const onAbort = () => reject(abort.signal.reason)
      abort.signal.addEventListener('abort', onAbort, { once: true })
      promise
        .then(resolve, reject)
        .finally(() => abort.signal.removeEventListener('abort', onAbort))
      if (abort.signal.aborted) onAbort()
    })
  return new ReadableStream<Uint8Array>({
    cancel() {
      connected = false
    },
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        if (!connected) return
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          )
        } catch {
          connected = false
        }
      }
      const stopHeartbeat = startHeartbeat(controller, () => connected)
      try {
        const result = await withinDeadline(
          run(agent, [opening, ...turns], {
            stream: true,
            maxTurns: 6,
            signal: abort.signal,
          }),
        )
        // Observe completion immediately, including rejection before the text stream ends.
        const completed = result.completed
        void completed.catch(() => undefined)
        const iterator = result.toTextStream()[Symbol.asyncIterator]()
        while (true) {
          const next = await withinDeadline(iterator.next())
          if (next.done) break
          content += next.value
          emit('delta', { text: next.value })
        }
        await withinDeadline(completed)
        const blocks = block ? [block] : []
        await db.transaction(async (tx) => {
          abort.signal.throwIfAborted()
          await tx.insert(message).values({
            id: reply.replyId,
            conversationId,
            clientMessageId: reply.clientMessageId,
            role: 'assistant',
            content,
            status: 'completed',
            citations: evidence.citations,
            blocks,
            completedAt: new Date(),
          })
          await tx
            .update(conversation)
            .set({ lastMessageAt: new Date() })
            .where(eq(conversation.id, conversationId))
          const usage = result.state.usage
          await tx.insert(aiUsageEvent).values({
            organizationId: record.organizationId,
            assistantId,
            conversationId,
            kind: 'chat',
            provider: env.LLM_PROVIDER,
            model: languageModels[agentModels.visitorChat.model].id,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: costUsd(agentModels.visitorChat.model, usage),
          })
        })
        emit('done', {
          messageId: reply.replyId,
          // The owner's preview can open any source; visitors only links.
          citations: preview
            ? evidence.citations
            : visitorCitations(evidence.citations),
          blocks,
        })
      } catch (error) {
        const code = abort.signal.aborted
          ? 'generation_timeout'
          : 'agent_failed'
        try {
          await failReply(reply, code, content)
        } catch {
          console.error('Could not save failed reply')
        }
        emit('error', { code })
        console.error(
          'Chat generation failed',
          error instanceof Error ? error.name : 'Unknown error',
        )
      } finally {
        clearTimeout(timeout)
        stopHeartbeat()
        if (connected) {
          try {
            controller.close()
          } catch {
            /* Client already disconnected. */
          }
        }
      }
    },
  })
}

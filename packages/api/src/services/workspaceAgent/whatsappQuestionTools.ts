import { tool } from '@openai/agents'
import { z } from 'zod'
import {
  defaultWhatsappApproach,
  defaultWhatsappQuestion,
  whatsappApproaches,
  whatsappQuestionLimits,
} from '../../config/whatsappQuestion.config'
import type {
  iOwnerWhatsappQuestion,
  iWhatsappNumberLookup,
} from '../../types/whatsappQuestion.types'
import { ApiError } from '../http/apiError'
import { createWorkspaceApiClient } from './apiClient'
import type { tExecute } from './managementTools'
import { ownedChat } from './store'
import type { iWorkspaceToolContext } from './tools'

// The WhatsApp question (docs/whatsappQuestion.md): the starter question
// that moves a visitor to WhatsApp. The number is a fact in Your business;
// the PUT route saves a typed one as the `WhatsApp` note.

export function buildWhatsappQuestionTools(
  ctx: iWorkspaceToolContext,
  execute: tExecute,
) {
  const request = createWorkspaceApiClient(
    ctx.headers,
    ctx.dispatch,
    ctx.signal,
  )
  async function paths() {
    const chat = await ownedChat(ctx.headers, ctx.chatId)
    if (!chat.organizationId)
      throw new ApiError(409, 'workspace_required', 'Create a workspace first')
    if (!chat.assistantId)
      throw new ApiError(409, 'assistant_required', 'Your AI isn’t set up yet')
    const ai = `/api/organizations/${encodeURIComponent(chat.organizationId)}/assistants/${encodeURIComponent(chat.assistantId)}`
    return { ai, question: `${ai}/whatsapp-question` }
  }
  async function current() {
    const { ai, question } = await paths()
    const bot = await request<{
      appearance: { whatsapp?: iOwnerWhatsappQuestion | null }
    }>(ai)
    const saved = bot.appearance.whatsapp ?? null
    if (saved)
      return {
        on: true,
        question: saved.question,
        approach: saved.approach,
        number: saved.number,
        numberSource: saved.numberSource,
      }
    const known = await request<iWhatsappNumberLookup>(`${question}/number`)
    return {
      on: false,
      question: null,
      approach: null,
      number: known.number,
      numberSource: known.source,
    }
  }
  return [
    tool({
      name: 'get_whatsapp_question',
      description:
        'Read the WhatsApp question: whether it is on, its text, what you do when someone taps it (approach; custom when its rule was changed), and the WhatsApp number you share (from the WhatsApp channel or Your business; null when none is known).',
      parameters: z.object({}),
      execute: execute('get_whatsapp_question', current),
    }),
    tool({
      name: 'set_whatsapp_question',
      description:
        'Turn on or change the WhatsApp question. Leave out what stays the same. Pass number only when the owner gave one; it is saved to Your business as a fact. Refused when no number is known and none is given.',
      parameters: z.object({
        question: z
          .string()
          .trim()
          .min(1)
          .max(whatsappQuestionLimits.questionLength)
          .optional(),
        approach: z.enum(whatsappApproaches).optional(),
        number: z.string().trim().min(1).max(200).optional(),
      }),
      execute: execute(
        'set_whatsapp_question',
        async (input) => {
          const now = await current()
          if (!input.number && !now.number)
            throw new ApiError(
              422,
              'whatsapp_number_missing',
              'No WhatsApp number is known yet. Ask “What’s your WhatsApp number or link?” and pass it as number.',
            )
          const { question } = await paths()
          const saved = await request<iOwnerWhatsappQuestion>(question, 'PUT', {
            question: input.question ?? now.question ?? defaultWhatsappQuestion,
            approach: input.approach ?? now.approach ?? defaultWhatsappApproach,
            ...(input.number ? { number: input.number } : {}),
          })
          return {
            on: true,
            question: saved.question,
            approach: saved.approach,
            number: saved.number,
            numberSource: saved.numberSource,
            savedToYourBusiness: Boolean(input.number),
          }
        },
        true,
      ),
    }),
    tool({
      name: 'remove_whatsapp_question',
      description:
        'Remove the WhatsApp question and its rule, only when the owner asks. The number stays in Your business.',
      parameters: z.object({}),
      execute: execute(
        'remove_whatsapp_question',
        async () => {
          await request((await paths()).question, 'DELETE')
          return { on: false }
        },
        true,
      ),
    }),
  ]
}

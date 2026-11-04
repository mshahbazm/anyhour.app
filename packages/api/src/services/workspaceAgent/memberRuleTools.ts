import { tool } from '@openai/agents'
import { z } from 'zod'
import { memberRuleLimits } from '../../config/memberRules.config'
import type {
  iMemberRule,
  iMemberRuleDrafts,
} from '../../types/memberRule.types'
import { ApiError } from '../http/apiError'
import { createWorkspaceApiClient } from './apiClient'
import type { tExecute } from './managementTools'
import { ownedChat } from './store'
import type { iWorkspaceToolContext } from './tools'
import { createUiBlock } from './uiBlocks'

// The AI's rules (docs/yourAi.md, "Rules"). Every call goes through the
// HTTP API as the signed-in user, so each route re-checks the workspace and
// the user's permission (members read only).

export function buildMemberRuleTools(
  ctx: iWorkspaceToolContext,
  execute: tExecute,
) {
  const request = createWorkspaceApiClient(
    ctx.headers,
    ctx.dispatch,
    ctx.signal,
  )
  async function rulesPath() {
    const chat = await ownedChat(ctx.headers, ctx.chatId)
    if (!chat.organizationId)
      throw new ApiError(409, 'workspace_required', 'Create a workspace first')
    return `/api/organizations/${encodeURIComponent(chat.organizationId)}/rules`
  }
  // What the agent reads back after a change: short, with ids.
  const brief = (rules: iMemberRule[]) =>
    rules.map((rule) => ({
      id: rule.id,
      ...(rule.kind === 'steps'
        ? { when: rule.when, steps: rule.steps }
        : { rule: rule.text }),
      ...(rule.tag ? { tag: rule.tag } : {}),
    }))
  const step = z.string().trim().min(1).max(memberRuleLimits.stepLength)
  return [
    tool({
      name: 'draft_member_rules',
      description:
        'Turn what the owner said about how you should behave with customers into rules (one line each) or steps for a situation ("when someone wants to book: first…, then…"), shown as a card with a Save button. Pass their own words. Nothing is saved until they tap Save or say yes (save_member_rules). Facts about the business are not rules, even when the owner says when to share them ("if someone asks for our WhatsApp, give them wa.me/…" is a fact: add-knowledge). A rule still makes sense with the details taken out.',
      parameters: z.object({
        text: z
          .string()
          .trim()
          .min(1)
          .max(4000)
          .describe('The owner’s words, as they said them.'),
      }),
      execute: execute(
        'draft_member_rules',
        async ({ text }) => {
          const { drafts } = await request<iMemberRuleDrafts>(
            `${await rulesPath()}/drafts`,
            'POST',
            { text },
          )
          if (!drafts.length)
            return {
              drafts: [],
              note: 'Nothing in that reads as a rule. If it holds information about the business (a number, link, price, hours, policy), save it with add-knowledge; otherwise ask what they want you to do.',
            }
          const { block, message } = await createUiBlock(ctx, {
            type: 'ruleDraft',
            rules: drafts,
            status: 'proposed',
          })
          return { blockId: block.id, drafts, message }
        },
        true,
      ),
    }),
    tool({
      name: 'save_member_rules',
      description:
        'Save the rules on a card draft_member_rules showed, when the owner says yes in the chat instead of tapping Save.',
      parameters: z.object({ blockId: z.string().min(1) }),
      execute: execute(
        'save_member_rules',
        async ({ blockId }) => {
          const block = await request<{ payload: { status: string } }>(
            `/api/workspace-agent/chats/${encodeURIComponent(ctx.chatId)}/blocks/${encodeURIComponent(blockId)}/rule-draft`,
            'POST',
            { action: 'save' },
          )
          return {
            status: block.payload.status,
            rules: brief(await request<iMemberRule[]>(await rulesPath())),
          }
        },
        true,
      ),
    }),
    tool({
      name: 'update_member_rule',
      description:
        'Change one of your rules by id (from "Your rules"): its wording, or a set of steps’ when and steps. Null leaves a field as it is. Returns every rule after the change.',
      parameters: z.object({
        ruleId: z.string().min(1),
        text: z
          .string()
          .trim()
          .min(1)
          .max(memberRuleLimits.textLength)
          .nullable()
          .describe('The rule as one short sentence, or a steps’ short title.'),
        when: z
          .string()
          .trim()
          .min(1)
          .max(memberRuleLimits.whenLength)
          .nullable()
          .describe('Steps only: "When someone wants to book a visit".'),
        steps: z
          .array(step)
          .min(memberRuleLimits.minSteps)
          .max(memberRuleLimits.maxSteps)
          .nullable()
          .describe('Steps only: every step, in order.'),
      }),
      execute: execute(
        'update_member_rule',
        async ({ ruleId, ...input }) => {
          const body = Object.fromEntries(
            Object.entries(input).filter(([, value]) => value !== null),
          )
          if (!Object.keys(body).length)
            return {
              error: 'nothing_to_change',
              message: 'Give at least one field to change.',
            }
          return {
            rules: brief(
              await request<iMemberRule[]>(
                `${await rulesPath()}/${encodeURIComponent(ruleId)}`,
                'PATCH',
                body,
              ),
            ),
          }
        },
        true,
      ),
    }),
    tool({
      name: 'order_member_rules',
      description:
        'Put your rules in a new order: the ids of every rule in "Your rules", once each.',
      parameters: z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }),
      execute: execute(
        'order_member_rules',
        async ({ ids }) => {
          return {
            rules: brief(
              await request<iMemberRule[]>(
                `${await rulesPath()}/order`,
                'POST',
                {
                  ids,
                },
              ),
            ),
          }
        },
        true,
      ),
    }),
    tool({
      name: 'delete_member_rule',
      description: 'Remove one of your rules by id, when the owner asks.',
      parameters: z.object({ ruleId: z.string().min(1) }),
      execute: execute(
        'delete_member_rule',
        async ({ ruleId }) => {
          return {
            rules: brief(
              await request<iMemberRule[]>(
                `${await rulesPath()}/${encodeURIComponent(ruleId)}`,
                'DELETE',
              ),
            ),
          }
        },
        true,
      ),
    }),
  ]
}

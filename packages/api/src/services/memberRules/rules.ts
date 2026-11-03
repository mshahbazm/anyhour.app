import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { memberRule } from '../../db/schema'
import { memberRuleLimits } from '../../config/memberRules.config'
import type {
  tMemberRuleInput,
  tUpdateMemberRuleInput,
} from '../../schemas/memberRule.schema'
import type { iMemberRule } from '../../types/memberRule.types'
import { ApiError } from '../http/apiError'

// The AI's rules (docs/yourAi.md, "Rules"). A workspace has one AI, so its
// rules belong to the workspace.

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type tExecutor = typeof db | tTransaction
type tRow = typeof memberRule.$inferSelect

// Changes to one workspace's rules run one at a time, so positions and
// limits stay right.
const lockRules = (tx: tTransaction, organizationId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`memberRules:${organizationId}`}))`,
  )

export function publicRule(row: tRow): iMemberRule {
  return {
    id: row.id,
    kind: row.kind,
    tag: row.tag,
    text: row.text,
    when: row.kind === 'steps' ? row.when : null,
    steps: row.kind === 'steps' ? (row.steps ?? []) : null,
    position: row.position,
  }
}

async function rows(executor: tExecutor, organizationId: string) {
  return executor
    .select()
    .from(memberRule)
    .where(eq(memberRule.organizationId, organizationId))
    .orderBy(asc(memberRule.position), asc(memberRule.createdAt))
}

/** The workspace's rules in position order; what the AI's prompts read. */
export async function listMemberRules(
  organizationId: string,
  executor: tExecutor = db,
) {
  return (await rows(executor, organizationId)).map(publicRule)
}

// The next free position, and whether there is room for more.
async function nextPosition(
  tx: tTransaction,
  organizationId: string,
  adding: number,
) {
  const [{ next, total }] = await tx
    .select({
      next: sql<number>`coalesce(max(${memberRule.position}) + 1, 0)::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(memberRule)
    .where(eq(memberRule.organizationId, organizationId))
  if (total + adding > memberRuleLimits.maxRules)
    throw new ApiError(
      422,
      'too_many_rules',
      `The AI can have up to ${memberRuleLimits.maxRules} rules`,
    )
  return next
}

function fields(input: tMemberRuleInput) {
  return input.kind === 'steps'
    ? {
        kind: 'steps' as const,
        text: input.text,
        when: input.when,
        steps: input.steps,
        tag: input.tag ?? null,
      }
    : {
        kind: 'rule' as const,
        text: input.text,
        when: null,
        steps: null,
        tag: input.tag ?? null,
      }
}

/** Adds rules at the end; pass a transaction to join one. */
export async function createMemberRules(
  organizationId: string,
  inputs: tMemberRuleInput[],
  executor?: tTransaction,
) {
  const run = async (tx: tTransaction) => {
    await lockRules(tx, organizationId)
    let next = await nextPosition(tx, organizationId, inputs.length)
    const created = await tx
      .insert(memberRule)
      .values(
        inputs.map((input) => ({
          ...fields(input),
          organizationId,
          position: next++,
        })),
      )
      .returning({ id: memberRule.id })
    return {
      ids: created.map((item) => item.id),
      rules: await listMemberRules(organizationId, tx),
    }
  }
  return executor ? run(executor) : db.transaction(run)
}

async function ownedRule(
  tx: tTransaction,
  organizationId: string,
  ruleId: string,
) {
  const [found] = await tx
    .select()
    .from(memberRule)
    .where(
      and(
        eq(memberRule.id, ruleId),
        eq(memberRule.organizationId, organizationId),
      ),
    )
    .for('update')
  if (!found) throw new ApiError(404, 'rule_missing', 'Rule not found')
  return found
}

export async function updateMemberRule(
  organizationId: string,
  ruleId: string,
  input: tUpdateMemberRuleInput,
) {
  return db.transaction(async (tx) => {
    await lockRules(tx, organizationId)
    const found = await ownedRule(tx, organizationId, ruleId)
    if (found.kind === 'rule' && (input.when || input.steps))
      throw new ApiError(422, 'not_steps', 'Only steps have a when and steps')
    const set: Partial<typeof memberRule.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (input.text !== undefined) set.text = input.text
    if (input.when !== undefined) set.when = input.when
    if (input.steps !== undefined) set.steps = input.steps
    if (input.tag !== undefined) set.tag = input.tag
    await tx.update(memberRule).set(set).where(eq(memberRule.id, found.id))
    return listMemberRules(organizationId, tx)
  })
}

export async function deleteMemberRule(organizationId: string, ruleId: string) {
  return db.transaction(async (tx) => {
    const found = await ownedRule(tx, organizationId, ruleId)
    await tx.delete(memberRule).where(eq(memberRule.id, found.id))
    return listMemberRules(organizationId, tx)
  })
}

// Positions from the order of ids, which must name every rule once.
export async function orderMemberRules(organizationId: string, ids: string[]) {
  return db.transaction(async (tx) => {
    await lockRules(tx, organizationId)
    const existing = await rows(tx, organizationId)
    const known = new Set(existing.map((item) => item.id))
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== known.size ||
      ids.some((id) => !known.has(id))
    )
      throw new ApiError(422, 'invalid_order', 'List every rule once')
    for (const [position, id] of ids.entries())
      await tx.update(memberRule).set({ position }).where(eq(memberRule.id, id))
    return listMemberRules(organizationId, tx)
  })
}

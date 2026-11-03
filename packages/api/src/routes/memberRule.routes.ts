import { Hono } from 'hono'
import { draftTextSchema } from '../schemas/draft.schema'
import {
  createMemberRulesSchema,
  orderMemberRulesSchema,
  updateMemberRuleSchema,
} from '../schemas/memberRule.schema'
import { requirePermission } from '../services/auth/authorize'
import { validateJson } from '../services/http/validateJson'
import { draftRuleFromText } from '../services/memberRules/drafts'
import {
  createMemberRules,
  deleteMemberRule,
  listMemberRules,
  orderMemberRules,
  updateMemberRule,
} from '../services/memberRules/rules'

// The AI's rules (docs/yourAi.md, "Rules"): everyone in the workspace reads
// them; owners and admins change them. Every change returns the list.
export const memberRuleRoutes = new Hono()

const base = '/:organizationId/rules'

memberRuleRoutes.get(base, async (c) => {
  const { organizationId } = c.req.param()
  await requirePermission(
    c.req.raw.headers,
    organizationId,
    'assistant',
    'read',
  )
  return c.json(await listMemberRules(organizationId))
})

memberRuleRoutes.post(
  base,
  validateJson(createMemberRulesSchema),
  async (c) => {
    const { organizationId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'update',
    )
    const { rules } = await createMemberRules(
      organizationId,
      c.req.valid('json').rules,
    )
    return c.json(rules, 201)
  },
)

// Rules drafted from the owner's words, for them to check; saves nothing.
memberRuleRoutes.post(
  `${base}/drafts`,
  validateJson(draftTextSchema),
  async (c) => {
    const { organizationId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'update',
    )
    return c.json(
      await draftRuleFromText(organizationId, c.req.valid('json').text),
    )
  },
)

memberRuleRoutes.post(
  `${base}/order`,
  validateJson(orderMemberRulesSchema),
  async (c) => {
    const { organizationId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'update',
    )
    return c.json(
      await orderMemberRules(organizationId, c.req.valid('json').ids),
    )
  },
)

memberRuleRoutes.patch(
  `${base}/:ruleId`,
  validateJson(updateMemberRuleSchema),
  async (c) => {
    const { organizationId, ruleId } = c.req.param()
    await requirePermission(
      c.req.raw.headers,
      organizationId,
      'assistant',
      'update',
    )
    return c.json(
      await updateMemberRule(organizationId, ruleId, c.req.valid('json')),
    )
  },
)

memberRuleRoutes.delete(`${base}/:ruleId`, async (c) => {
  const { organizationId, ruleId } = c.req.param()
  await requirePermission(
    c.req.raw.headers,
    organizationId,
    'assistant',
    'update',
  )
  return c.json(await deleteMemberRule(organizationId, ruleId))
})

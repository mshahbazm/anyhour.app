import { and, eq, isNull } from 'drizzle-orm'
import { getAuth } from '../../auth/auth'
import { db } from '../../db'
import {
  assistant,
  knowledgeSource,
  organization,
  workspaceChat,
  workspaceMessage,
} from '../../db/schema'
import type { tCreateWorkspaceInput } from '../../schemas/workspace.schema'
import {
  aiFirstMessage,
  defaultAiJob,
  defaultAiName,
} from '../../config/onboarding.config'
import { createBotPicture } from '../assistants/botPicture'
import { findWorkspaceAi } from '../assistants/workspaceAi'
import { requirePermission, requireSession } from '../auth/authorize'
import { ApiError } from '../http/apiError'
import { businessOwner, lockOwner, ownedBy } from '../knowledge/owner'
import { createRunRequest, dispatchRunRequest } from '../knowledge/runRequests'
import { normalizeUrl } from '../knowledge/web'
import { ownWebsiteOrigin } from '../widget/ownWebsite'
import { syncWebsiteChannels } from '../connections/website'
import { ownerThreadTitle } from '../teamChat/thread'

// The workspace name when none is typed: the website's name
// ("jonesroofing.co.uk" -> "Jonesroofing"), else "<first name>'s business".
export function workspaceName(
  websiteUrl: string | undefined,
  userName: string,
) {
  const label = websiteUrl
    ? new URL(websiteUrl).hostname.replace(/^www\./, '').split('.')[0]
    : ''
  if (label)
    return label
      .split(/[-_]+/)
      .filter(Boolean)
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(' ')
  const first = userName.trim().split(/\s+/)[0]
  return first ? `${first}’s business` : 'My business'
}

function slugFor(name: string) {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace'
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

// Creates a workspace for the signed-in user through Better Auth, which
// makes them its owner and its session's active workspace.
export async function createWorkspace(headers: Headers, name: string) {
  try {
    const created = await getAuth().api.createOrganization({
      body: { name, slug: slugFor(name) },
      headers,
    })
    if (!created) throw new Error('No workspace returned')
    return created.id
  } catch (error) {
    throw new ApiError(
      400,
      'workspace_failed',
      error instanceof Error && error.message
        ? error.message
        : 'The workspace could not be created',
    )
  }
}

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// The business website goes to Your business once (a workspace filled in
// later may have it already). The caller dispatches the returned run after
// its transaction commits.
async function addBusinessWebsite(
  tx: tTransaction,
  organizationId: string,
  websiteUrl: string,
) {
  const business = businessOwner(organizationId)
  await lockOwner(tx, business)
  const sites = await tx
    .select({ inputUrl: knowledgeSource.inputUrl })
    .from(knowledgeSource)
    .where(
      and(
        ownedBy(knowledgeSource, business),
        eq(knowledgeSource.kind, 'website'),
      ),
    )
  const origin = new URL(websiteUrl).origin
  if (
    sites.some(
      (site) => site.inputUrl && new URL(site.inputUrl).origin === origin,
    )
  )
    return null
  const [source] = await tx
    .insert(knowledgeSource)
    .values({
      ...business,
      kind: 'website',
      inputUrl: websiteUrl,
      discoveredVia: 'manual',
    })
    .returning()
  return createRunRequest(tx, business, source.id, 'created')
}

// Sign-up onboarding: the user's workspace, their website (when given)
// added to Your business, and the workspace's one AI with the name they
// chose, which answers that website (docs/focusedProduct.md, "One AI per
// business"). A workspace without its AI yet is filled in instead of a new
// one made.
//
// The person's owner chat (the thread their WhatsApp and Slack share) opens
// with the AI's first message.
export async function createOnboardedWorkspace(
  headers: Headers,
  input: tCreateWorkspaceInput,
) {
  const session = await requireSession(headers)
  const websiteUrl = input.websiteUrl
    ? normalizeUrl(input.websiteUrl)
    : undefined
  if (input.organizationId)
    await requirePermission(
      headers,
      input.organizationId,
      'assistant',
      'update',
    )
  const organizationId =
    input.organizationId ??
    (await createWorkspace(
      headers,
      workspaceName(websiteUrl, session.user.name),
    ))
  const origin = websiteUrl && ownWebsiteOrigin(websiteUrl)
  const aiName = input.aiName ?? defaultAiName
  const { run, ai } = await db.transaction(async (tx) => {
    await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .for('update')
    if (await findWorkspaceAi(organizationId, tx))
      throw new ApiError(409, 'ai_exists', 'This workspace already has its AI')
    // The browser's time zone, unless the workspace already has one.
    if (input.timeZone)
      await tx
        .update(organization)
        .set({ timeZone: input.timeZone })
        .where(
          and(
            eq(organization.id, organizationId),
            isNull(organization.timeZone),
          ),
        )
    const [ai] = await tx
      .insert(assistant)
      .values({
        organizationId,
        name: aiName,
        job: defaultAiJob,
        allowedOrigins: origin ? [origin] : [],
      })
      .returning({ id: assistant.id })
    if (origin) await syncWebsiteChannels(tx, organizationId, ai.id, [origin])
    const [chat] = await tx
      .insert(workspaceChat)
      .values({
        userId: session.user.id,
        organizationId,
        assistantId: ai.id,
        shared: true,
        title: ownerThreadTitle,
      })
      .returning({ id: workspaceChat.id })
    await tx.insert(workspaceMessage).values({
      chatId: chat.id,
      clientMessageId: 'onboarding',
      role: 'assistant',
      content: aiFirstMessage({
        ownerName: session.user.name,
        aiName,
        host: origin
          ? new URL(origin).hostname.replace(/^www\./, '')
          : undefined,
      }),
      completedAt: new Date(),
    })
    const run = websiteUrl
      ? await addBusinessWebsite(tx, organizationId, websiteUrl)
      : null
    return { run, ai }
  })
  if (run) await dispatchRunRequest(run.id)
  // A photo takes about 20 seconds, so it's made after the reply.
  void createBotPicture(organizationId, ai.id, {
    style: null,
    description: null,
  }).catch(() => undefined)
  return { organizationId, assistantId: ai.id }
}

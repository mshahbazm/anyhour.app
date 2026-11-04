import { tool } from '@openai/agents'
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db'
import { workspaceUiBlock } from '../../db/schema'
import type { iPendingNote } from '../../db/schema/product/workspaceUiBlock'
import { ApiError } from '../http/apiError'
import type { createWorkspaceApiClient } from './apiClient'
import type { iWorkspaceToolContext } from './tools'
import { createUiBlock } from './uiBlocks'

type tRequest = ReturnType<typeof createWorkspaceApiClient>
type tExecute = <T extends Record<string, unknown>>(
  name: string,
  fn: (input: T) => Promise<unknown>,
  mutation?: boolean,
) => (input: T) => Promise<unknown>

// Saving what the owner tells the bot. A fact taught in chat outranks the
// website, so saving one that a page contradicts waits for the owner's
// answer on a confirmation card, and a confirmed save applies exactly that.
export function createFactSaving(input: {
  ctx: iWorkspaceToolContext
  request: tRequest
  assistantBase: () => Promise<string>
  businessBase: () => Promise<string>
}) {
  const { ctx, request, assistantBase, businessBase } = input
  async function saveNote(note: iPendingNote) {
    const { conflicts, youWillSay } = await request<{
      conflicts: Array<{ sourceIds: string[]; page: string; pageSays: string }>
      youWillSay: string | null
    }>(`${await assistantBase()}/notes/conflicts`, 'POST', {
      noteId: note.noteId,
      title: note.title,
      text: note.text,
    })
    if (!conflicts.length) return writeNote(note)
    const one = conflicts.length === 1
    const shown = await createUiBlock(
      ctx,
      {
        type: 'confirmation',
        title: one
          ? `Your ${conflicts[0].page} page says something different`
          : 'Your website says something different',
        description: `Visitors reading ${one ? 'that page' : 'those pages'} will see the website's answer while I give yours, until you update ${one ? 'it' : 'them'}. If the page changes later, I'll check with you.`,
        items: [
          ...conflicts.map((item) => ({
            label: `${item.page} page says`,
            value: item.pageSays,
          })),
          { label: 'I’ll say', value: youWillSay ?? note.title },
        ],
        options: [
          {
            value: 'keepWebsite',
            label: 'Keep the website’s answer',
            description: null,
          },
          {
            value: 'confirm',
            label: 'Use my new answer',
            description: 'Your website and I will differ on this',
          },
        ],
      },
      undefined,
      {
        ...note,
        overrides: conflicts.flatMap((item) =>
          item.sourceIds.map((sourceId) => ({
            sourceId,
            excerpt: item.pageSays,
          })),
        ),
      },
    )
    return {
      saved: false,
      confirmationId: shown.block.id,
      websiteSays: conflicts,
      next: 'Not saved: their website says something different, so a confirmation card is now shown. End this turn with at most one short sentence (the card shows the options; never list them in text). If they confirm, with the button or a yes in their own words, call save_confirmed_fact with this confirmationId. If they keep the website’s answer, save nothing.',
    }
  }
  async function writeNote(note: iPendingNote) {
    const base = await businessBase()
    const saved = await request<Record<string, unknown>>(
      note.noteId
        ? `${base}/notes/${encodeURIComponent(note.noteId)}`
        : `${base}/notes`,
      note.noteId ? 'PUT' : 'POST',
      {
        title: note.title,
        text: note.text,
        overrides: note.overrides,
        ...(!note.noteId && note.fromMessageId
          ? { fromMessageId: note.fromMessageId }
          : {}),
      },
    )
    return { ...saved, savedTo: 'Your business' }
  }
  // Saves exactly what a website-conflict card showed, once the owner said yes.
  async function saveConfirmed(confirmationId: string) {
    const [block] = await db
      .select()
      .from(workspaceUiBlock)
      .where(
        and(
          eq(workspaceUiBlock.id, confirmationId),
          eq(workspaceUiBlock.chatId, ctx.chatId),
          isNotNull(workspaceUiBlock.pendingNote),
        ),
      )
      .limit(1)
    const pending = block?.pendingNote
    if (!block || !pending)
      throw new ApiError(
        404,
        'confirmation_missing',
        'No confirmation card with this id',
      )
    if (block.status === 'pending')
      throw new ApiError(
        409,
        'confirmation_pending',
        'The owner has not answered the card yet. End the turn and wait.',
      )
    if (block.status === 'consumed')
      throw new ApiError(
        409,
        'confirmation_used',
        'This confirmation was already saved',
      )
    if (block.status === 'resolved' && block.resolvedValue !== 'confirm')
      throw new ApiError(
        409,
        'owner_kept_website',
        'The owner chose to keep the website’s answer. Save nothing.',
      )
    // Only the newest card counts: an older or declined change is never revived.
    const [newer] = await db
      .select({ id: workspaceUiBlock.id })
      .from(workspaceUiBlock)
      .where(
        and(
          eq(workspaceUiBlock.chatId, ctx.chatId),
          isNotNull(workspaceUiBlock.pendingNote),
          ne(workspaceUiBlock.id, block.id),
          // Compared in SQL: JS dates drop the microseconds Postgres keeps.
          sql`${workspaceUiBlock.createdAt} > (select ${workspaceUiBlock.createdAt} from ${workspaceUiBlock} where ${workspaceUiBlock.id} = ${block.id})`,
        ),
      )
      .limit(1)
    if (newer || Date.now() - block.createdAt.getTime() > 24 * 60 * 60 * 1000)
      throw new ApiError(
        409,
        'confirmation_stale',
        'This confirmation is out of date. Save the fact again to ask the owner again.',
      )
    const [claimed] = await db
      .update(workspaceUiBlock)
      .set({ status: 'consumed' })
      .where(
        and(
          eq(workspaceUiBlock.id, block.id),
          eq(workspaceUiBlock.status, block.status),
        ),
      )
      .returning({ id: workspaceUiBlock.id })
    if (!claimed)
      throw new ApiError(
        409,
        'confirmation_used',
        'This confirmation was already saved',
      )
    try {
      return await writeNote(pending)
    } catch (error) {
      // Not saved, so the owner's answer still stands for a retry.
      await db
        .update(workspaceUiBlock)
        .set({ status: block.status })
        .where(eq(workspaceUiBlock.id, block.id))
      throw error
    }
  }
  return { saveNote, saveConfirmed }
}

// The tools for what the bot knows: look things up, save facts (asking first
// when the website disagrees) and settle website changes.
export function buildKnowledgeTools(input: {
  execute: tExecute
  request: tRequest
  assistantBase: () => Promise<string>
  businessBase: () => Promise<string>
  saveNote: (note: iPendingNote) => Promise<unknown>
  saveConfirmed: (confirmationId: string) => Promise<unknown>
}) {
  const {
    execute,
    request,
    assistantBase,
    businessBase,
    saveNote,
    saveConfirmed,
  } = input
  return [
    tool({
      name: 'search_knowledge',
      description:
        'Search what you know (Your business), exactly as visitors get it: passages with their source title, URL and origin ("owner" for facts taught in chat, "website" for pages and documents). Use before saving or changing a fact to see what the website says about it, or to say where you learned something.',
      parameters: z.object({ question: z.string().trim().min(1).max(500) }),
      execute: execute('search_knowledge', async ({ question }) =>
        request(
          `${await assistantBase()}/knowledge/search?q=${encodeURIComponent(question)}`,
        ),
      ),
    }),
    tool({
      name: 'add_knowledge_note',
      description:
        'Save facts on a new topic the user tells you in chat (prices, hours, policies, FAQs, product details, phone or WhatsApp numbers, links, addresses), including when they say when to share them, to Your business as a short note visitors can be answered from. Instructions about how you behave are not notes (member-rules). If a note on the topic exists, use update_knowledge_note instead. If their website says something different, it shows the owner a confirmation card instead of saving. fromMessageId is set only by the offer to remember a reply; pass null.',
      parameters: z.object({
        title: z.string().trim().min(1).max(120),
        text: z.string().trim().min(1).max(20000),
        fromMessageId: z.string().min(1).nullable(),
      }),
      execute: execute(
        'add_knowledge_note',
        async ({ title, text, fromMessageId }) =>
          saveNote({ noteId: null, title, text, overrides: [], fromMessageId }),
        true,
      ),
    }),
    tool({
      name: 'list_knowledge_notes',
      description:
        'Read the facts you were taught in chat (one note per topic, with ids, full text and the pages each one knowingly differs from). Check this before saving or changing a fact.',
      parameters: z.object({}),
      execute: execute('list_knowledge_notes', async () =>
        request(`${await businessBase()}/notes`),
      ),
    }),
    tool({
      name: 'update_knowledge_note',
      description:
        'Edit a note in place when a fact changes or grows: pass the full new text (keep what is still true, change what changed, drop what no longer applies). If their website says something different, it shows the owner a confirmation card instead of saving.',
      parameters: z.object({
        noteId: z.string(),
        title: z.string().trim().min(1).max(120),
        text: z.string().trim().min(1).max(20000),
      }),
      execute: execute(
        'update_knowledge_note',
        async ({ noteId, title, text }) =>
          saveNote({ noteId, title, text, overrides: [] }),
        true,
      ),
    }),
    tool({
      name: 'save_confirmed_fact',
      description:
        'Save the fact from a website-conflict confirmation card exactly as it was shown, after the owner said yes in their own words. A tap on "Use my new answer" is saved automatically.',
      parameters: z.object({ confirmationId: z.string().min(1) }),
      execute: execute(
        'save_confirmed_fact',
        async ({ confirmationId }) => saveConfirmed(confirmationId),
        true,
      ),
    }),
    tool({
      name: 'my_sources',
      description:
        'List everything you learn from (Your business): each website, page or file with its kind, pages learned and when it was last read, and how many notes there are. Use for "what do you know?", "what files do you have?" or "where did you learn that?".',
      parameters: z.object({}),
      execute: execute('my_sources', async () =>
        request(`${await businessBase()}/catalogue`),
      ),
    }),
    tool({
      name: 'resolve_website_change',
      description:
        "Apply the owner's decision on a website change that disagrees with one of their facts (listed under website changes waiting for a decision): keep their version, or follow the website (the note is rewritten to match the page).",
      parameters: z.object({
        decisionId: z.string().min(1),
        decision: z.enum(['keep', 'useWebsite']),
      }),
      execute: execute(
        'resolve_website_change',
        async ({ decisionId, decision }) =>
          request(
            `${await businessBase()}/decisions/${encodeURIComponent(decisionId)}`,
            'PATCH',
            { decision },
          ),
        true,
      ),
    }),
    tool({
      name: 'remove_knowledge_note',
      description:
        'Forget a whole note when the owner says it no longer applies.',
      parameters: z.object({ noteId: z.string() }),
      execute: execute(
        'remove_knowledge_note',
        async ({ noteId }) => {
          await request(
            `${await businessBase()}/notes/${encodeURIComponent(noteId)}`,
            'DELETE',
          )
          return { removed: noteId }
        },
        true,
      ),
    }),
  ]
}

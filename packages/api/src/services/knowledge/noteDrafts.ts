import { z } from 'zod'
import type { tNoteDraft } from '../../types/draft.types'
import { draftFromText } from '../ai/draftFromText'
import { listNotes } from './notes'
import type { iKnowledgeOwner } from './owner'

// "Tell (name) something about your business": the owner's words drafted
// into one note (title and clean text) for the normal note save. An
// instruction about how the AI behaves is a rule, not a fact, and isn't
// drafted.

const noteLimits = { title: 120, text: 2000 } as const

const draftSchema = z.object({
  kind: z.enum(['fact', 'rule']),
  title: z.string().nullable(),
  text: z.string().nullable(),
})

export const noteDraftInstructions = `Return exactly one record for what the owner told you about their business.
- kind "fact": something true about the business (prices, opening hours, services, delivery, policies, location, how something works). title is the topic in two to six words ("Opening hours", "Delivery charges"). text is the fact in plain words, as the business stating it, in one to three short sentences. Keep every detail the owner gave; add nothing.
- kind "rule": an instruction about how the AI should talk or behave ("be more formal", "always ask for their postcode", "never mention discounts"). title and text are null.
- When the text has several facts, title the main topic and keep all of them in text.
- context.notes lists the notes already saved. When the fact is on the same topic as one of them, use that note's title exactly, and write text as the whole updated note: the owner's new words, plus what that note says that they didn't change. This is the only time you repeat anything from context.
Report nothing in "missing".`

const sameTitle = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/** One note drafted from the owner's words, or a rule to add in Rules. Saves nothing. */
export async function draftNoteFromText(
  owner: iKnowledgeOwner,
  text: string,
): Promise<tNoteDraft> {
  const notes = await listNotes(owner)
  const { records } = await draftFromText({
    task: 'noteDrafts',
    instructions: noteDraftInstructions,
    schema: draftSchema,
    context: {
      notes: notes.map((note) => ({ title: note.title, text: note.text })),
    },
    text,
    maxRecords: 1,
    usage: { organizationId: owner.organizationId },
  })
  const [record] = records
  if (record?.kind === 'rule') return { kind: 'rule' }
  const title = record?.title?.slice(0, noteLimits.title)
  const body = record?.text?.slice(0, noteLimits.text)
  if (!title || !body) return { kind: 'nothing' }
  const existing = notes.find((note) => sameTitle(note.title, title))
  return {
    kind: 'note',
    title: existing?.title ?? title,
    text: body,
    noteId: existing?.id ?? null,
  }
}

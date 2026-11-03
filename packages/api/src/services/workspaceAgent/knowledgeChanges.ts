import { listNotes } from '../knowledge/notes'
import type { iKnowledgeOwner } from '../knowledge/owner'

interface iSavedNote {
  id: string
  title: string
  text: string
}

const squash = (value: string) => value.replace(/\s+/g, ' ').trim()

function savedNote(result: unknown): iSavedNote | null {
  if (!result || typeof result !== 'object') return null
  const { id, title, text } = result as Record<string, unknown>
  return typeof id === 'string' &&
    typeof title === 'string' &&
    typeof text === 'string'
    ? { id, title, text }
    : null
}

// Facts this chat saved that the owner has since deleted or edited elsewhere
// (the Your business page). Earlier replies would otherwise keep repeating them,
// so the helper is told plainly what no longer holds.
export async function knowledgeChangesSinceChat(
  reader: iKnowledgeOwner,
  actions: Array<{ name: string; status: string; result: unknown }>,
) {
  const saved = new Map<string, iSavedNote>()
  const removedHere = new Set<string>()
  for (const action of actions) {
    if (action.status !== 'completed') continue
    if (action.name === 'remove_knowledge_note') {
      const removed = (action.result as { removed?: unknown } | null)?.removed
      if (typeof removed === 'string') removedHere.add(removed)
      continue
    }
    const note = savedNote(action.result)
    if (note) saved.set(note.id, note)
  }
  if (!saved.size) return []
  const current = await listNotes(reader)
  const changes: string[] = []
  for (const note of saved.values()) {
    if (removedHere.has(note.id)) continue
    const now = current.find((item) => item.id === note.id)
    if (!now)
      changes.push(
        `- Deleted ${JSON.stringify(note.title)} (it said: ${JSON.stringify(note.text.slice(0, 300))}). You no longer tell visitors this; on this point you answer from the website again.`,
      )
    else if (squash(now.text) !== squash(note.text))
      changes.push(
        `- Edited ${JSON.stringify(now.title)}. It now says: ${JSON.stringify(now.text.slice(0, 400))}`,
      )
  }
  return changes
}

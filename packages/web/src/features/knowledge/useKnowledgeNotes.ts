import { useEffect, useState } from 'react'
import { api } from '../workspace/api'

// Mirrors GET .../notes in packages/api/src/routes/knowledgeSources.routes.ts.
export interface iKnowledgeNote {
  id: string
  title: string
  text: string
  status: string
  updatedAt: string
  /** Pages this fact knowingly differs from; the owner's version wins. */
  overrides: Array<{ sourceId: string; page: string }>
}

// Facts the owner told the bot in chat. Re-read whenever the set of note
// sources changes, e.g. after the bot saves or edits one.
export function useKnowledgeNotes(base: string | null, version: string) {
  const [notes, setNotes] = useState<iKnowledgeNote[]>([])
  useEffect(() => {
    if (!base) {
      setNotes([])
      return
    }
    let current = true
    api<iKnowledgeNote[]>(`${base}/notes`)
      .then((rows) => current && setNotes(rows))
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [base, version])
  return notes
}

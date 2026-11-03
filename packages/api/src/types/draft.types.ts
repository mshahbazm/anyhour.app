// A field the owner's text didn't give, or gave in a form that can't be saved.
export interface iDraftMissing {
  // Which draft (0-based).
  index: number
  field: string
  message: string
}

// POST .../business/notes/drafts: what the owner told the AI on Your
// business, drafted as one note. `noteId` is the note with the same title,
// which the save updates instead of adding another. A rule ("be more
// formal") belongs on the Rules page; nothing means no fact was found.
export type tNoteDraft =
  | { kind: 'note'; title: string; text: string; noteId: string | null }
  | { kind: 'rule' }
  | { kind: 'nothing' }

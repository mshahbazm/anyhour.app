# Owner corrections and website changes

Status: **phases 1–3 built**. Lets the owner train the bot by talking to it, without adding sources, and keeps those corrections right when the website changes later.

## What exists today

- **Notes are their own source kind** (`kind: 'note'`) and **learned in the request** (`services/knowledge/notes.ts`): one embedding call, no queue or page-profile model, so a fact is live on the next reply. Older queued jobs for a note are closed, and deleting a note never waits on indexing.
- **The owner's word wins**: retrieval tags passages `owner | website`, ranks notes 0.05 closer, and the visitor grounding playbook prefers the owner's facts without mentioning the disagreement.
- **Ask before going out of sync**: every note save runs `POST .../notes/conflicts` (search plus a small `factConflict` model call). If a page says something different, nothing is saved: the server shows a confirmation card in the chat comparing the page with the new answer, with the change stored on the card (`workspace_ui_block.pending_note`). Tapping **Use my new answer** saves before the helper replies; a typed yes goes through `save_confirmed_fact`. Either way it saves exactly what the card showed, once, and never from a declined or older card.
- **Corrections are recorded** in `knowledge_correction` (page, its words, page version). Pages a note already overrides aren't asked about again.
- **Website changes are re-checked** in the `refresh-overview` job after reading settles, only for pages whose content hash changed (`checkCorrections`): words still there → nothing; site agrees → retired quietly; page now says something new → `needsReview`. The bot keeps the owner's version until they decide.
- **The owner decides**: "Your website changed" on Knowledge (counted in the sidebar badge), or in chat (`resolve_website_change`). *Keep mine* records the new page version; *Use the website* rewrites the note to follow the page (or removes it if nothing else remains). Notes that differ from a page show a "Differs from website" tag.

## The cases to handle

1. **New fact** ("we're open Sundays"): a note. Works today.
2. **Look up** ("what do you tell people about refunds?"): the helper searches and answers with where it learned it.
3. **Correct** ("change it to 30 days"): the bot must stop using the website's version, even though the page still says 14 days.
4. **The website changes later** and agrees or disagrees with what the owner said. The owner decides, once, in plain words.

## Design

### 1. The owner's word wins

- Retrieval returns each passage's origin: `owner` for notes, `website` / `document` otherwise.
- Visitor prompt rule: *facts the owner told you override website or document passages when they disagree; never mention the disagreement to visitors.*
- Rank notes slightly above equally similar website chunks, so a correction is always in the top five.

### 2. The helper can look things up and correct them

- New helper tool `search_knowledge` (reuses `searchKnowledge` with no conversation). It returns passages with source title and URL, so it can say *"Your Pricing page says 14 days."*
- New tool `correct_fact({ title, text, replaces })`. It writes or updates the topic's note and records what it replaces: `{ sourceId, excerpt, sourceHash }`.
- Skill update (`add-knowledge`): when the owner says "change/that's wrong", search first, show what the bot says now and where it came from, correct it, then confirm: *"Done. I'll say 30 days. Your website still says 14, so update it when you can."*

### 3. Store corrections explicitly

New table `knowledge_correction`:

| column | purpose |
|---|---|
| `noteId` | the owner's fact |
| `sourceId`, `excerpt` | the website text it replaces |
| `sourceHash` | the page version at the time of the correction |
| `status` | `active` · `needsReview` · `retired` |
| `reviewedAt` | last owner decision |

Plain facts (no `replaces`) don't need a row; section 4 checks them by similarity.

### 4. When the website changes

After a source is re-read and its hash changed:

1. **Linked corrections** for that source: is the excerpt still there?
   - Still there: nothing changes; the owner's version keeps winning.
   - Gone or changed: ask a small model to compare the note with the new passage. It answers `agrees`, `conflicts` or `unrelated`.
2. **Plain notes**: find notes whose embedding is close to the changed chunks, then run the same comparison.
3. Outcomes:
   - `agrees`: retire the correction quietly. The site caught up; keep the note.
   - `unrelated`: nothing.
   - `conflicts`: `needsReview`. **Keep answering with the owner's version** until they decide. They said it explicitly; the site may be stale.

Run this inside the existing re-index job, only for changed sources, with a cap per run, so cost stays proportional to change.

### 5. What the owner sees

- **Knowledge → "What Tom knows"**: a "Needs your decision" block above the tabs (like unanswered questions), one card per conflict:
  > Your website now says **$899** for Website Design. You told Tom **$799**.
  > **Use the website** · **Keep $799**
  - *Use the website* removes or edits the note, so the bot follows the site again.
  - *Keep* updates `sourceHash`, so the same change isn't raised again.
- The sidebar Knowledge badge counts unanswered questions plus decisions.
- In "What you told Tom", corrected facts show a small **Replaces website** tag. Opening one shows the website text it overrides.
- The chat helper mentions open decisions once, when the owner next opens the chat. It doesn't nag.

## Phases

1. **Precedence and lookup**: origin tags, prompt rule, ranking boost, helper `search_knowledge`, skill update. Small; fixes wrong answers right away.
2. **Corrections**: `knowledge_correction` table, `correct_fact` tool, "Replaces website" tag.
3. **Change detection**: compare on re-index, `needsReview`, decision cards, badge.
4. **Later**: email digest of decisions; correction history per fact.

## Open questions

- Should a correction ever expire on its own (e.g. a seasonal price), or only by owner decision? Proposal: only by decision; the helper can offer an end date when the owner says "until …".
- When several pages state the same fact, one correction should cover all of them. Store several `replaces` rows per note.
- Corrections are per bot, like the rest of knowledge.

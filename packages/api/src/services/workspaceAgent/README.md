# Workspace agent

The agent the owner chats with in the dashboard (and from WhatsApp or Slack).
It sets up the business, makes rules, handles leads and more, by
calling the same HTTP API the dashboard uses. Product words come from
`docs/glossary.md`.

## How it fits together

| Part                | Where                                                                                                           | Loaded                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| System prompt       | `systemPrompt.ts`, in sections; `buildSystemPrompt` assembles them                                              | Every turn                                                                                   |
| Facts in the prompt | `promptFacts.ts` (the agent, its workspace)                                                                     | Every turn, read fresh                                                                       |
| Skills              | `skills/<name>/SKILL.md`, listed in `skills/loader.ts`                                                          | Only the catalog (name + description) every turn; the body when the agent calls `read_skill` |
| Tools               | `*Tools.ts` by area, joined in `tools.ts`                                                                       | Every turn                                                                                   |
| Chat cards          | Payloads in `src/schemas/workspaceUi.schema.ts`, the note the agent gets in `cards.ts`, stored by `uiBlocks.ts` | When a tool shows one                                                                        |
| A turn              | `answer.ts` streams the reply and tool calls                                                                    | —                                                                                            |

Keep each kind of text in its place:

- **System prompt**: only what applies to every conversation (who the agent
  is, how it talks, safety). A feature's procedure is a skill, not a prompt
  line.
- **Skill**: the step-by-step for one task, naming its tools. Long is fine;
  it loads only when needed.
- **Tool description**: one line on what the tool does and when to use it.
- **Tool result**: what happened, plus a note when the agent must act on it.
  Card notes come from `cards.ts`, never written inline.

## Adding a skill

1. Create `skills/<kebab-name>/SKILL.md`:

   ```md
   ---
   name: kebab-name
   description: One sentence saying when to use it (shown in every prompt).
   tools: tool_one, tool_two
   ---

   # Title

   The procedure, in short bullets.
   ```

2. Import it in `skills/loader.ts` and add it to `sources`.
3. `test/unit/workspaceSkills.test.ts` checks that each listed tool exists
   and is named in the body, and that every tool belongs to a skill.

## Adding a tool

1. Add it to the `*Tools.ts` file for its area (or a new one, joined in
   `tools.ts`). Wrap it in `execute(name, fn, mutation)`; pass `true` for
   anything that changes data, so a turn never repeats it.
2. Call the product API through `request`, never the database, so permissions
   and validation stay in one place.
3. Hard-to-undo actions from chat apps ask first: add the tool to
   `confirmFirstTools` in `src/config/teamChat.config.ts`.
4. Name it in the skill that uses it.

## Adding a chat card

A card shows something the owner can act on, with its own button. The agent
says one short line above it, never repeats it, and treats a "yes" typed in
the chat as pressing the button (the "Cards" rule in `systemPrompt.ts`).

1. Add the payload to `workspaceCardSchema` in
   `src/schemas/workspaceUi.schema.ts`.
2. Add its note to `blockNote` in `cards.ts` (TypeScript fails until you
   do): the question it shows, its button, and which tool a "yes" calls.
3. Show it from a tool with `createUiBlock(ctx, payload)` and return the
   `message` it gives back.
4. Render it in `packages/web/src/features/workspace/chatBlock.tsx`, using the
   same question and button words as its note.

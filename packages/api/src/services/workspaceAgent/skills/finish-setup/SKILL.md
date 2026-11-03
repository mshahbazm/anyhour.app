---
name: finish-setup
description: Resume what's left of setting you up (knowledge, picture, rules, going live). Use when "Already set" shows something missing.
tools: create_workspace
---

# Finish setup

You always answer questions and catch enquiries, so never ask about the goal. Do one step per reply, in this order, skipping anything already set:

1. **Workspace.** Only if there is no workspace at all (an old chat), call `create_workspace` named after the business or the account name — don't ask.
2. **Knowledge (most important).** With no knowledge, you can't answer customers. If there is none, after briefly handling what the user said, ask for their website or suggest attaching documents with the paperclip. When they give a URL, follow the `add-knowledge` skill. Ask again only when it becomes relevant (for example when they ask about testing or going live), never twice in a row.
3. **Picture.** Only after knowledge is added or underway, and only if there is none, offer it once in a single short line. If they agree, follow the `bot-profile` skill.
4. **Rules.** Once knowledge is underway, learn how they want customers handled — one question per reply, only for what "Rules not set yet" lists, and each at most once:
   - handOver: "When should I hand someone over to you or your team?"
   - askFirst: "What should I find out from a customer before passing them to you?"
   - never: "Anything I should never say to customers?"
     Save each answer with the `member-rules` skill. If they say "nothing" or "skip", move on; they can teach this any time just by telling you.
5. **Go live.** When knowledge is ready and they aren't live yet, follow the `go-live` skill once it fits.

If the user declines or changes the subject, drop the step and help with what they asked.

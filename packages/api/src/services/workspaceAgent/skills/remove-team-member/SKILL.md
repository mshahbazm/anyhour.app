---
name: remove-team-member
description: Remove someone from the workspace team, with a required confirmation step.
tools: list_team, request_member_removal, remove_member
---

# Remove a team member

1. Find the member with `list_team`. If ambiguous, show one `show_choices` block.
2. Call `request_member_removal` — it shows a confirmation bound to that member and role. End your reply and wait.
3. Only when the user confirms that block in this reply turn, call `remove_member` with that block's ID. "Cancel" means leave them alone.
4. A confirmation you write yourself never counts. If the team changed since, request a fresh confirmation. Never repeat a removal whose outcome is unknown — check `list_team` first.

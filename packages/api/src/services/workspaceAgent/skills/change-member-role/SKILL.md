---
name: change-member-role
description: Change a team member's role (admin or member).
tools: list_team, update_member_role
---

# Change a member's role

1. Find the member with `list_team` (page through using total/offset if needed). If the name matches several people, show one `show_choices` block.
2. When the user has said the role, call `update_member_role` directly — no extra confirmation.
3. The owner's role and ownership transfer can't be changed here. If the backend denies a change, say so; don't try another route.

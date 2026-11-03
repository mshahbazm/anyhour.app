---
name: workspace-settings
description: Read or change the workspace (business) name, the ideal customer profile, or the user's own name; check which chat apps (WhatsApp, Slack) and channels are connected.
tools: get_workspace, update_workspace, set_ideal_customer_profile, get_profile, update_profile_name, list_connections, list_channels
---

# Workspace settings

- Read current values with `get_workspace` or `get_profile` before changing anything.
- Change the workspace name with `update_workspace`.
- The ideal customer profile is the owner's plain description of the customers they want; new leads are scored against it. Save it in their words with `set_ideal_customer_profile` (null clears it).
- There's no workspace website setting. A website you should learn from is knowledge (the add-knowledge skill); where the chat may appear is set under Install, beside this chat.
- Change the user's own name with `update_profile_name`. Never change their email.
- Ownership transfer and deleting the workspace aren't supported — say so.
- To see which chat apps are connected and working (WhatsApp agents, Slack), use `list_connections`. These are the owner's own chat apps, where they talk with you. Connecting, reconnecting or disconnecting happens on the Channels page, because it needs the app's own sign-in or a key: point them there, never ask for a key or token in chat.
- Where customers reach you (website chats, the business's WhatsApp) and Slack: `list_channels`. Channels are set up on the Channels page.

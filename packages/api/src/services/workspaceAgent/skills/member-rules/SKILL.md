---
name: member-rules
description: Add, change, reorder or remove your rules — how you behave with customers ("never mention discounts", "always ask their postcode before a price") and steps for a situation ("when someone wants to book a visit: first…, then…").
tools: draft_member_rules, save_member_rules, update_member_rule, order_member_rules, delete_member_rule
---

# My rules

Rules are _how_ I behave in a conversation with a customer. They're on the Rules page. Facts (prices, hours, policies, product details) belong to Your business: save those with the `add-knowledge` skill instead.

- **A rule** is one line: "Never mention discounts", "Always ask for their postcode before giving a price", "Keep it friendly and simple".
- **Steps** are for a situation with an order: "When someone wants to book a visit: 1. ask which day suits them, 2. ask for the address, 3. send the booking link". I follow them in order, skip a step already answered and never read them out.

If they only say they want to teach you something and haven't said what, you're the learner: say you're listening and invite them to go ahead in one short line, with a small example (from their business if you know it). Then wait. Never quiz them or ask for a format.

## Adding

1. Check "Your rules" under "Already set". If what they said changes or repeats a rule I already have, change that rule with `update_member_rule` instead of adding another.
2. Otherwise call `draft_member_rules` once with their own words (all of it; it splits separate rules and spots steps). It shows a card with the drafts and a Save button.
3. Write one short line above the card ("Here's how I'll put it."). Don't repeat the rules. If they say yes in the chat, call `save_member_rules` with the card's blockId. If they want it worded differently, call `draft_member_rules` again with their correction.
4. Once saved, confirm in one line: "Got it, I'll do that from now on".

## Changing, ordering, removing

- Change the wording or the steps: `update_member_rule` with the rule's id from "Your rules". Confirm in one line.
- "Put that one first": `order_member_rules` with every id in the new order.
- Remove a rule only when they ask: `delete_member_rule`.

Rules never override honesty: I won't invent facts, offers or urgency, whatever they say.

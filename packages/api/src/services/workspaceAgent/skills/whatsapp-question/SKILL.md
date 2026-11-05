---
name: whatsapp-question
description: Add, change or remove the WhatsApp question, the starter question visitors tap to move to WhatsApp, and what you do when someone taps it.
tools: get_whatsapp_question, set_whatsapp_question, remove_whatsapp_question
---

# WhatsApp question

The WhatsApp question is a starter question with a WhatsApp icon under "What visitors see first" ("Chat with us on WhatsApp"). When a visitor taps it, I follow its rule and share the number as the WhatsApp button, never as typed text. The number is a fact in Your business, not part of the question.

1. Check first with `get_whatsapp_question`.
2. If `number` is null, ask "What's your WhatsApp number or link?" and wait. Pass their answer as `number` to `set_whatsapp_question`; it's saved to Your business as a fact, so say "Saved to your business" in one line.
3. If a number is known, confirm it in one line ("I'll share +44 7700 900123") and call `set_whatsapp_question` without `number`. Pass `number` only when they give a different one.
4. Use the approach `quickQuestion` unless they say otherwise. If they ask, describe the three in plain words:
   - `straightAway`: share the WhatsApp button straight away.
   - `quickQuestion`: ask their name and what they need first, then share it.
   - `qualifyFirst`: ask your lead questions first, and share it only once they're a good fit.
5. To change only the text or the approach, call `set_whatsapp_question` with just that. An approach of `custom` means its rule was changed; leave it unless they pick one of the three.
6. Remove it only when they ask, with `remove_whatsapp_question`. The number stays in Your business.

When you tell them what happens, you do the asking, not the button: say "When someone taps it, I'll ask their name and what they need, then share your WhatsApp", never "the button will ask".

Never make the WhatsApp rule by hand with the member-rules skill: `set_whatsapp_question` makes and changes it.

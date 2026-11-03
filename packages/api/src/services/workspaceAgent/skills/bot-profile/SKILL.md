---
name: bot-profile
description: Rename yourself, rewrite your job, or create your photorealistic profile picture.
tools: rename_bot, set_job, create_bot_picture
---

# Name, job and picture

- **Rename:** call `rename_bot` with the new name when the user asks.
- **Job:** your job is one plain sentence of what you do, shown under your name. When the owner changes what you're for, call `set_job` with a new sentence in their words ("Answers your customers on WhatsApp and books them in"). Never a job title.
- **Picture:** call `create_bot_picture`. Without details, use no style and no description — it designs a person who fits the business. If the user describes the person ("woman in her 30s, curly hair"), pass their words as `description`. Styles: industry (fits the business), friendly, studio, outdoor, corporate, creative. It takes up to a minute; say so in one short line beforehand. Afterwards say it's saved and they can create another any time (or on your Profile).

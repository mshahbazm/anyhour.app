# Glossary

One meaning per word, in the screens, in the chat and in the code. If a new feature needs a word, check here first. Add a word only when an existing one can't carry the meaning.

| Word in the screens | What it means | In code |
|---|---|---|
| The AI's name; "your AI" where a generic word is needed | The business's one AI (docs/yourAi.md). It answers customers on every channel (website chat, WhatsApp) and talks with the owner and their team (this chat, their own WhatsApp and Slack). Made at sign-up; never added or deleted. Never "AI team member", "your AI team", "front desk", "employee", "bot", "assistant" or "agent" in the screens, and never "hire" | `assistant` (database) |
| Channels | Where customers reach the AI (website chat, WhatsApp Business) and where the owner's team reaches it (their own WhatsApp, Slack) | `connection`, `whatsapp_agent` |
| Team member | A real person invited to the workspace. Never used for the AI | `member` |
| Contact | One person, forever, however they reach you | `contact` |
| Lead | What the product is for: one person's interest in buying. Its status is New, Contacted, Won or Lost; a won lead can carry its value. Never "pipeline", "stage", "booking", "job" or "project" in the screens | `lead`, `lead.status` (called "deal" in planning docs) |
| Your business | Facts about the business that the AI knows: website, files and notes, including what it sells and its prices. The only layer of knowledge. Replaces "knowledge" and "training" in the UI. The page opens with a box to tell (name) something ("We're open 9 to 5"), saved straight away as a note under "What you told (name)" | `knowledge_*` (workspace) |
| Opening hours | When the business is open each week, in its time zone. Read from Your business (website pages, files, notes; notes win) and shown on that page; never typed into a form. To change them, the owner tells the AI. Until they're found, "outside business hours" means 18:00–08:00 and weekends | `organization.businessHours`, `organization.timeZone` |
| Rules | How the AI behaves in a conversation: one-line rules ("Never mention discounts") and steps for a situation ("When someone wants to book a visit: 1. … 2. …"). The Rules page (`/rules`), headed "How (name) talks to customers", in two sections: "In every chat" (one-line rules, grouped by what they do) and "When a situation comes up" (steps, followed in order, skipping what the customer already said). Replaces "How I talk" | `memberRule`, `memberRules` (feature code) |
| Conversation | Messages on one channel (website chat, WhatsApp) | `conversation` |
| Needs you | A conversation the AI handed to a person, until someone replies or hands it back to the AI | `conversation.needsHumanSince` |
| Answers learned | Notes saved from a person's reply to a customer, when the AI offered "Save this so I can answer it next time?" | `knowledge_source.discoveredVia = 'reply'` |
| Briefing | What the AI shows when the owner opens its chat, the first page after sign-in (`/`): conversations that need you, this month's funnel (website visitors → started a chat → leads caught → leads won), customers answered, times it needed you, answers learned, and the newest leads. The chat carries on below it. There is no separate dashboard | `features/briefing`, `monthStats` |
| Visitor counts | The owner's on/off switch for website insights: daily counts of visits and visitors, no cookies. Off by default; while on, the owner chooses what's counted (visits and pages, country, device and browser, chat opens; all on by default). The numbers are on the website's Insights tab and Home's funnel. Never "tracking" or "analytics" in the screens | `assistant.tracking`, `assistant.trackingOptions`, `services/insights/` |

## Rules
- **Never "deal" in the screens.** "Lead" is what owners see. "Deal" appears only in planning docs.
- **No explanations scattered around the UI.** Clear, consistent words do the work. An empty page may say in one line what goes there; that's all.
- **Facts vs rules decide where things go, not the screen they're typed on.** A fact is information about the business: prices, hours, policies, a phone or WhatsApp number, a link, an address. It goes to **Your business**, even when the owner says when to share it ("if someone asks for our WhatsApp, give them wa.me/123" is a fact). A rule is behaviour, a guardrail: tone, always or never, what to find out first and how to qualify, steps for a situation, when to hand over. It goes to **Rules**, and still makes sense with the details taken out. A message with both is split. In chat the AI says which in one line: "Saved to your business" or "Got it, I'll do that from now on". When it's unsure, it asks. The wording lives in `ruleOrFact` (`packages/api/src/config/memberRules.config.ts`).
- **The AI uses the same words in the owner chat.** When an owner uses another word ("package", "deal", "plan"), it understands and answers with ours, without correcting them.

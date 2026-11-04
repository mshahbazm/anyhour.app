// The AI's rules (docs/yourAi.md, "Rules"): how it behaves in a
// conversation. A rule is one line; steps are a short ordered procedure for
// one situation ("When someone wants to book a visit"). Both go into its
// prompts, so their size is bounded here.

export const memberRuleKinds = ['rule', 'steps'] as const
export type tMemberRuleKind = (typeof memberRuleKinds)[number]

// A quiet tag shown next to a rule, inferred when it's drafted; never typed.
export const memberRuleTags = [
  'always',
  'never',
  'tone',
  'askFirst',
  'handOver',
] as const
export type tMemberRuleTag = (typeof memberRuleTags)[number]

export const memberRuleLimits = {
  textLength: 300,
  whenLength: 200,
  stepLength: 200,
  minSteps: 2,
  maxSteps: 10,
  // Rules the workspace's AI can have.
  maxRules: 40,
  // Saved in one request (a drafted card holds at most this many).
  perSave: 10,
} as const

// What's a rule and what's a fact (docs/glossary.md, "Rules"): one wording
// for every prompt that decides where the owner's words are saved.
export const ruleOrFact = `Rules and facts are different, and are saved in different places:
- A fact is information about the business: prices, opening hours, services, a phone or WhatsApp number, an email, a link, an address, a policy, how something works. Facts go to Your business, with the website and files. Saying when to share a fact doesn't make it a rule: "If someone asks for our WhatsApp, give them wa.me/123" is the fact "Our WhatsApp is wa.me/123", because the AI already shares what it knows when it's relevant.
- A rule is behaviour, a guardrail on how the AI talks with customers: its tone, what it must always or never say or do, what it finds out first and how it qualifies someone, the steps to follow in order for a situation, and when it hands over to a person. A rule still makes sense with the details taken out.
- When one message holds both, split it: the detail is a fact, and the behaviour is a rule that refers to it without repeating it ("Offer our WhatsApp link before the chat ends").`

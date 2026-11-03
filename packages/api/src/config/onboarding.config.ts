// The AI sign-up makes (docs/focusedProduct.md, "Shorter onboarding").

// The AI's name until the owner renames it.
export const defaultAiName = 'Paige'

// A job is one plain sentence saying what the AI does.
export const jobLength = 300
export const defaultAiJob =
  'Answers your customers, catches the ones who want to buy and brings you in when they need you'

// The AI's first message in its owner chat, in its own voice. `host` is the
// website it answers from sign-up.
export function aiFirstMessage(input: {
  ownerName: string
  aiName: string
  host?: string
}) {
  const first = input.ownerName.trim().split(/\s+/)[0]
  const hello = `Hi${first ? ` ${first}` : ''}! I’m ${input.aiName}.`
  const work = input.host
    ? ` I’m reading ${input.host} now, so I can answer your customers there, catch the ones who want to buy and bring you in when they need you.`
    : ' Tell me your website and I’ll start reading it, so I can answer your customers there.'
  return `${hello}${work} ${whatsappOffer}`
}

export const whatsappOffer =
  'Want my updates on WhatsApp? Connect it on the Channels page.'

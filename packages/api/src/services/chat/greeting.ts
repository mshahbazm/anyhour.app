export const defaultWelcomeMessage = 'How can I help?'

// The chat opens with this. An untouched default introduces the bot by name,
// so visitors know who they're talking to and the bot never has to later.
export function visitorGreeting(bot: { name: string; welcomeMessage: string }) {
  const message = bot.welcomeMessage.trim()
  return !message || message === defaultWelcomeMessage
    ? `Hi, I’m ${bot.name.trim().slice(0, 120)} 👋 How can I help?`
    : message
}

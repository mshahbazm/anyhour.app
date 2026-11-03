import { apiOrigin } from '../workspace/api'
import type { iAssistant } from '../workspace/types'
import './bots.css'

const tints = [
  ['#e0e7ff', '#4338ca'],
  ['#dcfce7', '#15803d'],
  ['#ffedd5', '#c2410c'],
  ['#fce7f3', '#be185d'],
  ['#e0f2fe', '#0369a1'],
  ['#f3e8ff', '#7e22ce'],
] as const

export function botPictureUrl(
  organizationId: string | null,
  bot: Pick<iAssistant, 'id' | 'pictureKey'> | undefined,
) {
  if (!organizationId || !bot?.pictureKey) return null
  // The key changes with every new picture, so it doubles as a cache buster.
  return `${apiOrigin}/api/organizations/${encodeURIComponent(organizationId)}/assistants/${encodeURIComponent(bot.id)}/picture?v=${encodeURIComponent(bot.pictureKey)}`
}

// The bot's profile picture, or its initial until a picture exists.
export function BotAvatar({
  bot,
  organizationId,
  size = 28,
  className = '',
}: {
  bot: Pick<iAssistant, 'id' | 'name' | 'pictureKey'> | undefined
  organizationId: string | null
  size?: number
  className?: string
}) {
  const url = botPictureUrl(organizationId, bot)
  const style = { width: size, height: size, fontSize: size * 0.42 }
  if (url)
    return (
      <img
        className={`botAvatar ${className}`}
        src={url}
        alt=""
        style={style}
        draggable={false}
      />
    )
  const name = bot?.name.trim() || 'W'
  const [background, color] =
    tints[
      [...(bot?.id ?? name)].reduce(
        (sum, char) => sum + char.charCodeAt(0),
        0,
      ) % tints.length
    ]
  return (
    <span
      className={`botAvatar is-initial ${className}`}
      style={{ ...style, background, color }}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

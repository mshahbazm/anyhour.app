const minute = 60_000
const day = 24 * 60 * minute

// Short, friendly relative time: "just now", "5m ago", "Yesterday", "3 Oct".
export function formatWhen(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  const elapsed = Date.now() - date.getTime()
  if (elapsed < minute) return 'just now'
  if (elapsed < 60 * minute) return `${Math.floor(elapsed / minute)}m ago`
  if (elapsed < day && date.getDate() === new Date().getDate())
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
  if (elapsed < 2 * day) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== new Date().getFullYear()
      ? { year: 'numeric' }
      : {}),
  })
}

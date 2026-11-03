// Latest-started refresh wins, regardless of completion order: a result is
// newer when it came from a refresh that started after this one.
export function sourceHasNewerResult(
  source: { resultStartedAt: Date | null },
  startedAt: Date | null,
) {
  return Boolean(
    source.resultStartedAt &&
    (!startedAt || source.resultStartedAt > startedAt),
  )
}

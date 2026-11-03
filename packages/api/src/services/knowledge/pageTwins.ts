// Many sites serve one page at several addresses: "/terms" and "/terms.html",
// or "/start.html?package=mia" beside "/start.html". Learning each copy fills
// the source list with duplicates and repeats the same chunks in answers.

function parts(url: string) {
  const parsed = new URL(url)
  const path = parsed.pathname.replace(/\.html?$/i, '').replace(/\/$/, '')
  return {
    page: `${parsed.hostname.replace(/^www\./, '')}${path || '/'}`,
    query: parsed.search,
    extension: /\.html?$/i.test(parsed.pathname),
  }
}

/** Every address that could be a twin of this one starts with this path. */
export function twinPrefix(url: string) {
  const parsed = new URL(url)
  return `${parsed.origin}${parsed.pathname.replace(/\.html?$/i, '').replace(/\/$/, '')}`
}

// A query only marks a copy when the plain address exists too; "?id=1" and
// "?id=2" stay separate pages.
export function areTwinPages(first: string, second: string) {
  if (first === second) return false
  const a = parts(first)
  const b = parts(second)
  return a.page === b.page && (a.query === b.query || !a.query || !b.query)
}

/** Lower is the better address to keep: no query, then no ".html". */
function cost(url: string) {
  const { query, extension } = parts(url)
  return (query ? 2 : 0) + (extension ? 1 : 0)
}

export function preferredPage(first: string, second: string) {
  const difference = cost(first) - cost(second)
  if (difference) return difference < 0 ? first : second
  if (first.length !== second.length)
    return first.length < second.length ? first : second
  return first < second ? first : second
}

// Which pages of a website would be read, without reading them: runs the same
// plan a new website gets before its first read (services/knowledge/
// scopePlan.ts) and prints it. Fetches only the sitemap, the home page and
// the feed; saves nothing. One Jev call per site unless --no-ai.
//
//   bun run scope:preview https://example.com [https://other.com …] [--no-ai]
import { planScope } from '../src/services/knowledge/scopePlan'
import { ruleMatches } from '../src/services/knowledge/web'

const args = process.argv.slice(2)
const useAi = !args.includes('--no-ai')
const sites = args.filter((arg) => !arg.startsWith('--'))
if (!sites.length) {
  console.error('Usage: bun run scope:preview <url> [url …] [--no-ai]')
  process.exit(1)
}

const timeLimitMs = 120_000

const pad = (value: string | number, width: number) =>
  String(value).padEnd(width).slice(0, width)

for (const site of sites) {
  const siteUrl = /^https?:\/\//.test(site) ? site : `https://${site}`
  const started = Date.now()
  let cost = 0
  try {
    const plan = await Promise.race([
      planScope({
        siteUrl,
        excludePaths: [],
        ...(useAi && {
          onJevUsage: async (usage) => {
            cost += usage.costUsd
          },
        }),
      }),
      Bun.sleep(timeLimitMs).then(() => {
        throw new Error(`no plan within ${timeLimitMs / 1000}s`)
      }),
    ])
    const all = plan.groups.flatMap((group) => group.paths)
    const skipped = all.filter((path) =>
      plan.rules.some(({ rule }) => ruleMatches(path, rule)),
    )
    console.log(
      `\n=== ${siteUrl}` +
        (plan.found.site === new URL(siteUrl).origin
          ? ''
          : ` (redirects to ${plan.found.site})`) +
        (plan.found.homeLang ? ` · language ${plan.found.homeLang}` : ''),
    )
    console.log(
      `Found: ${plan.found.sitemapPages} sitemap pages, ${plan.found.homeLinks} home page links${plan.found.homeRead ? '' : ' (home page unreadable)'}, ${plan.found.feedArticles} feed articles` +
        (plan.found.sitemapPages
          ? ''
          : ' (no sitemap: planned from the home page)'),
    )
    console.log(
      `Read ${all.length - skipped.length} of ${all.length} known pages, skip ${skipped.length}` +
        (useAi ? ` · Jev $${cost.toFixed(5)}` : ' · no AI') +
        ` · ${((Date.now() - started) / 1000).toFixed(1)}s`,
    )
    console.log(
      `\n${pad('Group', 28)}${pad('Pages', 7)}${pad('Is', 10)}${pad('By', 6)}Examples`,
    )
    const folders = plan.groups.filter((group) => !group.single)
    const singles = plan.groups.filter((group) => group.single)
    for (const group of folders)
      console.log(
        `${pad(group.path, 28)}${pad(group.paths.length, 7)}${pad(group.kind ?? 'read', 10)}${pad(group.decidedBy === 'none' ? '' : group.decidedBy, 6)}${group.paths.slice(0, 2).join('  ')}`,
      )
    if (singles.length) {
      const byKind = new Map<string, string[]>()
      for (const group of singles) {
        const key = `${group.kind ?? 'read'}${group.decidedBy === 'none' ? '' : ` (${group.decidedBy})`}`
        byKind.set(key, [...(byKind.get(key) ?? []), group.path])
      }
      for (const [kind, paths] of byKind)
        console.log(
          `${pad('top-level pages', 28)}${pad(paths.length, 7)}${pad(kind, 16)}${paths.slice(0, 4).join('  ')}`,
        )
    }
    console.log('\nRules it would add:')
    if (!plan.rules.length) console.log('  none: every known page is read')
    for (const rule of plan.rules)
      console.log(`  ${pad(rule.rule, 40)}${rule.kind}, ${rule.pages} pages`)
  } catch (error) {
    console.log(`\n=== ${siteUrl}\nCould not plan: ${String(error)}`)
  }
}
process.exit(0)

// A new AI team member's website goes to Your business, which the shared
// test workspace's other AI team members would read too. Crawl tests give
// their AI team member the site as its own source instead, so nothing leaks
// between tests.
// `post` sends to the workspace's assistants collection; the result has the
// same shape as creating an AI team member with a website.
export async function createWithOwnWebsite(
  post: (path: string, body: object) => Promise<Response>,
  input: { name: string; websiteUrl: string; excludePaths?: string[] },
): Promise<Response> {
  const made = await post('', { name: input.name })
  if (made.status !== 201) return made
  const { assistant } = (await made.json()) as { assistant: { id: string } }
  const added = await post(`/${assistant.id}/sources`, {
    kind: 'website',
    url: input.websiteUrl,
    ...(input.excludePaths ? { excludePaths: input.excludePaths } : {}),
  })
  if (added.status !== 201) return added
  const { source, indexRun } = (await added.json()) as {
    source: unknown
    indexRun: unknown
  }
  return Response.json({ assistant, source, indexRun }, { status: 201 })
}

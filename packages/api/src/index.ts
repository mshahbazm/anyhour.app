import { app } from './app'
import { env } from './env'
import { heartbeatSeconds } from './services/http/eventStream'

// Bun closes a request after 10 s without traffic. Streams send heartbeats, so a
// few missed beats means the client is really gone; image generation is one
// long silent request with its own provider timeout.
const idleSeconds: Array<[RegExp, number]> = [
  [
    /^\/api\/widget\/[^/]+\/conversations\/[^/]+\/messages$/,
    heartbeatSeconds * 3,
  ],
  [/^\/api\/workspace-agent\/chats\/[^/]+\/messages$/, heartbeatSeconds * 3],
  [
    /^\/api\/workspace-agent\/chats\/[^/]+\/blocks\/[^/]+\/respond$/,
    heartbeatSeconds * 3,
  ],
  [
    /^\/api\/organizations\/[^/]+\/assistants\/[^/]+\/preview\/conversations\/[^/]+\/messages$/,
    heartbeatSeconds * 3,
  ],
  [/^\/api\/organizations\/[^/]+\/assistants\/[^/]+\/picture$/, 150],
]

Bun.serve({
  port: env.PORT,
  fetch(request, server) {
    if (request.method === 'POST') {
      const path = new URL(request.url).pathname
      const match = idleSeconds.find(([pattern]) => pattern.test(path))
      if (match) server.timeout(request, match[1])
    }
    return app.fetch(request, server)
  },
})

console.info(`Anyhour API listening on port ${env.PORT}`)

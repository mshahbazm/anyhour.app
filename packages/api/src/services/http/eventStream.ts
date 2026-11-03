// Server-sent events comment lines keep a quiet stream alive through Bun's idle
// timeout and proxies while a reply is still being worked on. Clients ignore them.
export const heartbeatSeconds = 10

export function startHeartbeat(
  controller: ReadableStreamDefaultController<Uint8Array>,
  isConnected: () => boolean,
) {
  const ping = new TextEncoder().encode(': keep-alive\n\n')
  const timer = setInterval(() => {
    if (!isConnected()) return
    try {
      controller.enqueue(ping)
    } catch {
      clearInterval(timer)
    }
  }, heartbeatSeconds * 1000)
  return () => clearInterval(timer)
}

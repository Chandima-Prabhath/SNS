/**
 * Custom Next.js server — mounts Socket.io on the SAME HTTP server as Next.js.
 *
 * Why a custom server?
 *   - Single port architecture: Next.js (REST + pages) + Socket.io (realtime
 *     chat + voice signaling) share port 3090. Easier to deploy behind one
 *     Cloudflare Tunnel.
 *   - No more Caddy multi-port routing, no more XTransformPort query param.
 *
 * Dev mode:  `bun run dev`     (this file via tsx, with HMR for Next)
 * Prod mode: `bun run start`   (compiles to .next/standalone/server.js
 *                                with this custom server baked in)
 */
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { attachRealtime } from './src/lib/realtime-server'

const PORT = parseInt(process.env.PORT || '3090', 10)
const DEV = process.env.NODE_ENV !== 'production'
const HOSTNAME = process.env.HOSTNAME || '0.0.0.0'

const app = next({ dev: DEV, hostname: HOSTNAME, port: PORT })
const handle = app.getRequestHandler()

async function main() {
  await app.prepare()

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url || '', true)
    handle(req, res, parsedUrl)
  })

  // Attach Socket.io to the SAME httpServer — shares the port with Next.js
  attachRealtime(httpServer)

  httpServer.listen(PORT, HOSTNAME, () => {
    console.log(`\n[SNS] ready on http://${HOSTNAME}:${PORT} (${DEV ? 'dev' : 'prod'})`)
    console.log(`[SNS] Next.js + Socket.io sharing port ${PORT}`)
    console.log(`[SNS] Socket.io path: /api/socket`)
  })

  const shutdown = (sig: string) => {
    console.log(`\n[SNS] ${sig} received, shutting down...`)
    httpServer.close(() => process.exit(0))
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('[SNS] failed to start:', err)
  process.exit(1)
})

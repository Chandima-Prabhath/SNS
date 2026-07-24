# SNS — Friends Social

A private social web app for you and your friends. Built to be lean, modular, and easy to maintain — no bloat.

## What's inside

- **Direct messages & group chat** — text, replies, edit, soft-delete, read receipts, typing indicators, media attachments
- **WhatsApp-style status** — 24h ephemeral stories with viewer list and privacy tiers
- **Telegram-style bots** — extensible command + mention framework. Drop a file in `src/lib/bot/bots/`, register, done.
- **Voice calls** — WebRTC mesh with Google's free STUN. Cloudflare TURN groundwork is wired but disabled by default (just add credentials to `.env`).
- **Admin panel** — manage users, channels, bots, view system status
- **Presence** — online/idle/dnd/offline with custom status
- **Dark mode by default** — clean, minimal, mobile-first

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 16 (App Router) | Server actions, RSC, simple deploys |
| Language | TypeScript everywhere | Catch bugs at compile time |
| DB | Prisma + SQLite | Zero-config dev. Swap `DATABASE_URL` for Postgres in prod |
| Realtime | Socket.io (mounted inside Next.js) | Standard, well-understood, dumb relay pattern |
| Auth | NextAuth.js (Credentials + JWT) | Simple, no external OAuth needed for a private app |
| State | Zustand (client) + TanStack Query (server) | Minimal boilerplate, great caching |
| UI | Tailwind 4 + shadcn/ui | Modern, accessible, easy to theme |
| Voice | WebRTC P2P mesh | Works for ≤6 participants. SFU-ready signaling for later. |

## Architecture: single-port (Cloudflare Tunnel–friendly)

**Everything runs on port 3090.** The Next.js app and the Socket.io realtime service share one HTTP server, so you only need to tunnel one port.

```
                    Cloudflare Tunnel
                          │
                          ▼
              ┌────────────────────────┐
              │   Next.js app (port 3090) │
              │   ├── HTTP routes /api/*    │
              │   ├── Pages /               │
              │   └── Socket.io /api/socket │  ← same process, same port
              └────────────────────────┘
```

This is implemented via a custom Next.js server in `server.ts`:

```ts
import next from 'next'
import { createServer } from 'http'
import { attachRealtime } from './src/lib/realtime-server'

const app = next({ dev, hostname, port: 3090 })
const handle = app.getRequestHandler()

await app.prepare()
const httpServer = createServer((req, res) => handle(req, res, parse(req.url, true)))
attachRealtime(httpServer)  // ← Socket.io attaches to the same httpServer
httpServer.listen(3090)
```

The browser connects to Socket.io via `io({ path: '/api/socket', withCredentials: true })` — same origin, cookies sent automatically, no CORS, no port juggling.

## Project structure

```
prisma/schema.prisma         # All data models (single source of truth)
server.ts                    # Custom Next.js server — mounts Socket.io on same port
src/
  app/
    page.tsx                 # Single-page app shell (root route)
    api/                     # REST API routes
      auth/                  # NextAuth + register + me
      channels/[id]/         # messages, members, read receipts
      groups/                # create, join, start DM
      bots/                  # CRUD + dispatch
      stories/               # CRUD + view tracking
      calls/                 # voice call lifecycle + ICE config
      admin/                 # admin-only endpoints
      upload/                # media upload
      seed/                  # one-click default group setup
  components/
    auth/                    # login/register screen
    layout/                  # sidebar + app shell
    chat/                    # channel list, message list, composer
    status/                  # WhatsApp-style stories
    voice/                   # voice channels + WebRTC UI
    bots/                    # bot management UI
    settings/                # profile + privacy
    admin/                   # admin panel
  hooks/                     # useSocket, useChannel, usePresence, useVoiceCall, useStories, useBots
  stores/                    # Zustand stores (app state, call state)
  lib/
    db.ts                    # Prisma client
    auth.ts                  # NextAuth config (JWT, role refresh)
    socket.ts                # socket.io client singleton (path: /api/socket)
    webrtc.ts                # VoiceCallManager (mesh, signaling, mute)
    turn.ts                  # Cloudflare TURN credential signer
    chat-utils.ts            # DM creation, channel membership helpers
    realtime-server.ts       # Socket.io server (auth via NextAuth JWT cookie)
    bot/
      framework.ts           # dispatcher, registry, BotContext
      index.ts               # registers all bundled bots
      bots/                  # echo, help, poll, remind (sample bots)
```

## Local development

```bash
bun install
bun run db:push          # create SQLite DB from schema
bun run dev              # starts Next.js + Socket.io on http://localhost:3090
```

Open `http://localhost:3090`, sign up, then click "Seed default group" to bootstrap the Friends group with `general`, `memes`, and `voice-hangout` channels.

## Production deployment via Cloudflare Tunnel

You said you'll handle Cloudflare Tunnel yourself — the app is now optimized for that:

1. **Single tunnel, single port.** Point your tunnel at `http://localhost:3090`. Both HTTP and WebSocket traffic go through the same connection.
2. **Set environment variables:**
   ```bash
   NEXTAUTH_URL=https://sns.1911915.xyz
   NEXTAUTH_SECRET=$(openssl rand -base64 32)
   PORT=3090
   ```
3. **Cloudflare Tunnel config (cloudflared):**
   ```yaml
   ingress:
     - hostname: sns.1911915.xyz
       service: http://localhost:3090
       originRequest:
         noTLSVerify: true
         http2Origin: false
     - service: http_status:404
   ```
   That's it. One hostname, one backend. No path-based routing needed.
4. **WebSocket support:** Cloudflare Tunnel supports WebSockets out of the box — no extra config needed. Socket.io will work over both `polling` and `websocket` transports.
5. **Database:** SQLite works for small groups. For >20 users, switch to PostgreSQL by changing `DATABASE_URL` and re-running `bun run db:push`.
6. **Uploads:** Currently stored in `public/uploads/`. For production, swap the `/api/upload` route to store to S3/R2 instead.

## Enabling Cloudflare TURN (free, optional)

Voice calls work without TURN (Google STUN alone handles ~70% of cases). When friends are behind strict NATs (mobile carriers, corporate Wi-Fi), TURN relays the audio.

To enable:

1. Cloudflare Dashboard → **Realtime & Calls** → **Create TURN App**
2. Copy the **Key ID** and **Key Secret** (keep secret server-side only)
3. Add to `.env`:
   ```
   CLOUDFLARE_TURN_KEY_ID=your_key_id
   CLOUDFLARE_TURN_KEY_SECRET=your_key_secret
   CLOUDFLARE_TURN_URL=turn:turn.cloudflare.com:3478?transport=udp
   ```
4. Restart the server. The `/api/calls/ice-servers` endpoint will start returning time-limited TURN credentials (HMAC-SHA1 signed server-side per call).

You can verify TURN status in the Admin Panel → System tab.

## Adding a new bot (the easy way)

1. Create `src/lib/bot/bots/<name>.ts`:
   ```ts
   import type { BotModule } from '../framework'

   export const myBot: BotModule = {
     name: 'mybot',
     description: 'Does something cool',
     commands: [
       {
         name: 'hello',
         description: 'Say hello',
         handler: async (ctx) => {
           await ctx.reply(`Hi @${ctx.senderName}!`)
         },
       },
     ],
   }
   ```

2. Register it in `src/lib/bot/index.ts`:
   ```ts
   import { myBot } from './bots/mybot'
   registerBotModule(myBot)
   ```

3. Create the bot via the Bots UI (or Admin panel), choose module `mybot`, and add it to a channel via Admin → Bots.

4. Users can now type `/hello` in that channel and the bot responds. Bots also receive `@mentions` if `privacyMode` is on.

The `BotContext` provides everything you need: `args`, `reply`, `getState`/`setState` (for multi-step flows), `bot.config` (per-bot JSON config), and more. See `src/lib/bot/bots/poll.ts` for a stateful example.

## Architecture decisions (why this isn't bloated)

- **Single-port architecture** — Next.js + Socket.io share one HTTP server via a custom `server.ts`. No Caddy multi-port routing, no `XTransformPort` query param. One tunnel, one process, one log file.
- **Polymorphic sender** — bots and users post to the same `Message` table. One set of message UI, threading, and reactions code. No parallel bot system.
- **Dumb realtime relay** — Socket.io only ferries events, never owns state. The DB is the source of truth. Easy to reason about, easy to debug.
- **In-process realtime auth** — Socket.io middleware decodes the NextAuth JWT directly from the cookie (no HTTP roundtrip to `/api/auth/me`). Same-process, sub-millisecond auth.
- **Bot framework = transport-agnostic** — currently only REST webhook style, but you can add a polling adapter or external webhook adapter without touching bot logic.
- **Single-page app shell** — view switching via Zustand state, not Next.js routes. Means no full page reloads between Chat/Status/Voice/Bots/Settings/Admin.
- **Self-contained modules** — every feature is one folder under `components/` + one hook + (optionally) one API route group. To remove a feature, delete the folder and the imports in `app-shell.tsx`.

## Debugging tips

- **App + realtime log:** `/home/z/my-project/dev.log` (single log file for everything)
- **Prisma queries:** already logged in dev mode
- **Socket events:** add `console.log` in `src/lib/realtime-server.ts` — Next.js dev mode auto-reloads
- **Bot dispatch:** `[bot]` prefixed console logs show module registration; `[bot dispatch]` shows errors

## What's intentionally NOT included (yet)

- End-to-end encryption (Signal-style) — bots would break E2EE; deferred
- Video calls — voice-only for now; same signaling layer would work for video
- Mobile push notifications — needs a service worker + FCM/APNs setup
- Search — small group, scroll back works fine
- File previews beyond images/videos — easy to add per MIME type
- SFU for >6-person voice — signaling layer is SFU-ready, just swap the WebRTC manager

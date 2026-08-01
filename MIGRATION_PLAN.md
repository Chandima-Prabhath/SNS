# Adoo — Prototype → Product Migration Plan

> **Target:** Azure VM (2 vCPU / 1GB RAM) · Next.js 16 + Socket.io + Prisma/SQLite
> **Goal:** Move from a freestyled prototype to a polished, secure, scalable product
> **Constraints:** Lightweight — no Docker, no microservices, no Redis. Single-process.

---

## Phase 1: Critical Fixes (Day 1)

> These block deployment or break core flows. Do these first.

### 1.1 Restore `/api/upload` route (CRITICAL)
- **File:** `src/app/api/upload/route.ts`
- **Issue:** Route keeps getting deleted. 8 client call sites depend on it.
- **Fix:** Create the route (auth-gated multipart upload, extension allowlist, 25MB cap). Add to `.gitignore` exceptions if needed.
- **Effort:** S

### 1.2 Remove `/api/seed` privilege escalation (CRITICAL)
- **File:** `src/app/api/seed/route.ts`
- **Issue:** Any authenticated user can become `owner` by calling `/api/seed` first.
- **Fix:** Gate behind env var `BOOTSTRAP_ADMIN_USERNAME` or remove the endpoint and use a CLI script.
- **Effort:** S

### 1.3 Add membership checks to all channel/group APIs (CRITICAL)
- **Files:** `src/app/api/channels/[id]/members/route.ts`, `src/app/api/calls/[id]/route.ts`, `src/app/api/channels/[id]/read/route.ts`, `src/app/api/channels/[id]/commands/route.ts`
- **Issue:** Any authenticated user can list members of ANY channel (including private DMs).
- **Fix:** Add `db.channelMember.findUnique({ where: { channelId_userId: { channelId, userId } } })` → 403 if null.
- **Effort:** S

### 1.4 Fail-fast on missing env vars (CRITICAL)
- **File:** `server.ts`
- **Issue:** Missing `NEXTAUTH_SECRET` causes cryptic runtime errors.
- **Fix:** Add startup check that exits with a clear message if `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `DATABASE_URL` are missing.
- **Effort:** S

### 1.5 Add rate limiting (HIGH)
- **File:** New `src/middleware.ts`
- **Issue:** No rate limits anywhere. Registration, login, ASR, TTS, message-send all wide open. A credential-stuffing attack will OOM the VM (bcrypt is sync).
- **Fix:** In-memory token-bucket per IP+path. Tiered: 5/min for auth & ASR/TTS, 30/min for register, 100/min for general API.
- **Effort:** M

### 1.6 Stream file uploads instead of buffering (HIGH)
- **File:** `src/app/api/uploads/[filename]/route.ts`
- **Issue:** `readFile(filePath)` loads entire file into RAM. 5 concurrent video plays = 250MB on a 1GB VM.
- **Fix:** Use `createReadStream(filePath, { start, end })` + `Readable.toWeb(stream)` (same pattern as music stream route).
- **Effort:** S

### 1.7 Fix ASR Python sidecar blocking (HIGH)
- **File:** `python-services/asr/server.py`
- **Issue:** `async def transcribe()` runs ONNX inference synchronously — blocks FastAPI's event loop. `/health` becomes unreachable during transcription.
- **Fix:** Change to `def transcribe()` (sync) so FastAPI runs it in a threadpool. Set `OMP_NUM_THREADS=1`.
- **Effort:** S

---

## Phase 2: Scalability & Performance (Day 2)

> These will break at 50+ users or under realistic load.

### 2.1 Fix N+1 query in `/api/channels` (HIGH)
- **File:** `src/app/api/channels/route.ts`
- **Issue:** Per-channel `findFirst` for latest message + sequential DM partner lookups.
- **Fix:** Single `db.$queryRaw` with `GROUP BY channelId` for latest messages. Batch DM partner lookups.
- **Effort:** M

### 2.2 Fix N+1 query in `/api/unread` (HIGH)
- **File:** `src/app/api/unread/route.ts`
- **Issue:** 2 queries per channel membership (40 sequential round-trips for 20 channels). Hit on every notification.
- **Fix:** Single `db.$queryRaw` with `LEFT JOIN`. Or store `lastReadAt` timestamp on `ChannelMember`.
- **Effort:** M

### 2.3 Add search to "Start DM" dialog (HIGH)
- **Files:** `src/components/chat/chat-list.tsx`, `src/components/chat/channel-list.tsx`, `src/app/api/users/route.ts`
- **Issue:** Loads ALL users. Breaks at 100+ users.
- **Fix:** Add debounced search input → `/api/users?search=...&limit=20`. Server adds `take: 20` + `orderBy: [{ status: 'desc' }, { username: 'asc' }]`.
- **Effort:** S

### 2.4 Add infinite scroll for messages (HIGH)
- **Files:** `src/hooks/useChannel.ts`, `src/components/chat/message-list.tsx`
- **Issue:** Only loads first 50 messages. Users can never scroll back.
- **Fix:** Convert to `useInfiniteQuery` with `getNextPageParam`. Add sentinel at top of message list.
- **Effort:** M

### 2.5 Bound Service Worker API cache (HIGH)
- **File:** `public/sw.js`
- **Issue:** Every `/api/*` response cached with no expiration. Will hit browser storage quota.
- **Fix:** Add LRU eviction (max 200 entries, max 24h). Exclude `/api/unread`, `/api/channels`, `/api/calls/pending` from caching.
- **Effort:** M

### 2.6 Add music cache eviction (MEDIUM)
- **File:** New `scripts/evict-music-cache.ts`
- **Issue:** `public/cache/music/*.mp3` files never deleted. Fills VM disk.
- **Fix:** Cron job or on-download check: LRU-evict when total cache > 1GB.
- **Effort:** S

### 2.7 Wrap multi-step writes in transactions (HIGH)
- **Files:** `src/app/api/bots/route.ts`, `src/app/api/groups/route.ts`, `src/app/api/groups/[id]/members/route.ts`
- **Issue:** Partial failures leave orphan rows (bot without user, group member without channel member).
- **Fix:** `db.$transaction(async (tx) => { ... })`. Use `getOrCreateDmChannel` as reference pattern.
- **Effort:** M

### 2.8 Fix `useSocket` listener leak (HIGH)
- **File:** `src/hooks/useSocket.ts`
- **Issue:** `connect`/`disconnect` listeners never removed. Stack up on every re-render.
- **Fix:** Capture socket in ref, call `s.off()` in cleanup.
- **Effort:** S

---

## Phase 3: Security Hardening (Day 3)

### 3.1 Session management — device tracking & force logout (MEDIUM)
- **Files:** `prisma/schema.prisma`, `src/lib/auth.ts`, `src/components/settings/settings-view.tsx`
- **Issue:** JWTs are stateless — stolen tokens valid for 30 days. Users can't see devices or force logout.
- **Fix:**
  1. Add `tokenVersion Int @default(0)` to User model
  2. Include `tokenVersion` in JWT via `jwt` callback
  3. In `session` callback, compare JWT `tokenVersion` to DB `tokenVersion` — mismatch = force re-auth
  4. Add "Sign out everywhere" button that increments `tokenVersion`
  5. Add `Session` model (id, userId, userAgent, ip, createdAt, lastActiveAt) for device list
  6. Add `/api/auth/sessions` GET (list) + DELETE (revoke)
- **Effort:** L

### 3.2 Multi-device push subscriptions (MEDIUM)
- **Files:** `prisma/schema.prisma`, `src/lib/push.ts`, `src/app/api/push/subscribe/route.ts`
- **Issue:** Push subscription stored as single `UserSetting` — second device overwrites first.
- **Fix:** Add `PushSubscription` model (userId, endpoint, keys JSON, userAgent, createdAt). Allow many per user. `sendPushNotification` iterates all.
- **Effort:** M

### 3.3 Input validation sweep (MEDIUM)
- **Files:** Most routes under `src/app/api/`
- **Issue:** Only `register` uses Zod. Most routes accept any input.
- **Fix:** Add Zod schemas to each handler. Centralize `validateBody(schema, body)` helper.
- **Effort:** M

### 3.4 Security headers middleware (LOW)
- **File:** New `src/middleware.ts`
- **Fix:** Add CSP, HSTS, X-Frame-Options, X-Content-Type-Options headers.
- **Effort:** S

### 3.5 Bind ASR/TTS to localhost (MEDIUM)
- **Files:** `python-services/asr/server.py`, TTS server config
- **Issue:** ASR binds to `0.0.0.0` — if firewall misconfigured, anyone can transcribe audio.
- **Fix:** Change default to `127.0.0.1`. Remove `allow_origins=['*']` CORS.
- **Effort:** S

### 3.6 Remove `ignoreBuildErrors` from next.config.ts (MEDIUM)
- **File:** `next.config.ts`
- **Issue:** TypeScript errors silently swallowed at build time.
- **Fix:** Remove `typescript: { ignoreBuildErrors: true }`. (Already fixed — 0 TS errors now.)
- **Effort:** S (done)

---

## Phase 4: Code Quality & Architecture (Day 4)

### 4.1 Extract bot framework helpers (HIGH)
- **File:** `src/lib/bot/framework.ts`
- **Issue:** ~250 lines duplicated between `dispatchBotUpdate` and `dispatchBotCallback`. They've silently diverged (callback's `controlMusic` still uses the broken `io.emit` pattern).
- **Fix:** Extract `buildBotContext(bot, params)` that returns the `BotContext` with all helpers. Both dispatchers call it.
- **Effort:** M

### 4.2 Split realtime-server into modules (MEDIUM)
- **File:** `src/lib/realtime-server.ts` (670 lines)
- **Issue:** Chat relay, presence, voice signaling, music room sync all in one file.
- **Fix:** Split into `realtime/chat.ts`, `realtime/presence.ts`, `realtime/voice.ts`, `realtime/music.ts`. Keep shared state in `realtime/state.ts`.
- **Effort:** L

### 4.3 Move `typingTimers` to module scope (MEDIUM)
- **File:** `src/lib/bot/framework.ts`
- **Issue:** Allocated per-dispatch — can't clear previous intervals. Memory leak.
- **Fix:** Module-level Map keyed by `botId`. Clear on dispatch completion.
- **Effort:** S

### 4.4 Replace verbose console.log with pino logger (MEDIUM)
- **Files:** `src/lib/realtime-server.ts` (45 logs), `src/app/api/uploads/[filename]/route.ts`, etc.
- **Issue:** Synchronous console.log in hot paths. Fills disk.
- **Fix:** Use `pino` with level gating. Demote per-request logs to `debug`.
- **Effort:** M

### 4.5 Remove dead code & unused dependencies (LOW)
- **Issue:** 90+ Radix UI components, many unused. `tool-results/` and `upload/` dirs committed.
- **Fix:** Run `knip` to find dead code. Add `tool-results/` and `upload/` to `.gitignore`.
- **Effort:** M

### 4.6 Enable React StrictMode (LOW)
- **File:** `next.config.ts`
- **Issue:** StrictMode is off — dev-time bugs (double effects, missing cleanups) don't surface.
- **Fix:** Set `reactStrictMode: true`. Fix resulting warnings.
- **Effort:** S

### 4.7 Reduce Prisma logging (LOW)
- **File:** `src/lib/db.ts`
- **Issue:** `log: ['query']` logs every SQL query in all environments.
- **Fix:** `log: process.env.NODE_ENV === 'development' ? ['query'] : ['error']`.
- **Effort:** S

---

## Phase 5: UX Polish (Day 5)

### 5.1 Add skeleton loaders (MEDIUM)
- **Files:** `src/components/chat/chat-list.tsx`, `src/components/chat/message-list.tsx`
- **Fix:** Render 5–8 `<Skeleton>` rows while `isLoading` is true.
- **Effort:** M

### 5.2 Add global search / command palette (MEDIUM)
- **Fix:** Add `/api/search?q=` that fans out to messages, channels, users, bots. Add `Cmd+K` palette.
- **Effort:** M

### 5.3 Add image caching for thumbnails (MEDIUM)
- **File:** `src/app/api/img/route.ts`
- **Issue:** Re-runs sharp on every request.
- **Fix:** Cache to `public/cache/img/<hash>.webp`. Or use Next.js `<Image>` component.
- **Effort:** M

### 5.4 Fix stories query to filter in DB (MEDIUM)
- **File:** `src/app/api/stories/route.ts`
- **Issue:** Loads ALL non-expired stories, filters in JS.
- **Fix:** Filter in Prisma query: `WHERE userId = currentUser OR audience = 'all' OR audienceList.some(a => a.userId = currentUser)`.
- **Effort:** M

### 5.5 Clean up `.env` and `.gitignore` (LOW)
- **Fix:** Add `.env` to `.gitignore`. Add `tool-results/` and `upload/` to `.gitignore`.
- **Effort:** S

---

## Architecture Notes

### What's already good (don't change):
- ✅ Single-process architecture (Next.js + Socket.io on one port)
- ✅ SQLite + Prisma with proper indexes and unique constraints
- ✅ Bot framework design (transport → dispatcher → middleware → module registry)
- ✅ WebRTC mesh for 1:1 and small group calls
- ✅ DmLink unique constraint for DM deduplication
- ✅ Server-side music preloading via `getOrCreateDownload`
- ✅ globalThis pattern for io + presence (dev-mode module context fix)
- ✅ Visual bot flow engine with try/catch + MAX_STEPS guard

### What to watch but don't fix yet:
- SQLite concurrent writes — enable WAL mode if `SQLITE_BUSY` errors appear
- WebRTC mesh — switch to SFU (LiveKit/mediasoup) if 8+ participant calls needed
- Music cache on disk — add eviction cron when disk fills
- Bot flow complexity — MAX_STEPS=50 is fine, but watch for flows with many AI/ASR/TTS nodes

---

## Execution Checklist

### Phase 1: Critical Fixes (Day 1)
- [ ] 1.1 Restore `/api/upload` route
- [ ] 1.2 Remove `/api/seed` privilege escalation
- [ ] 1.3 Add membership checks to all channel/group APIs
- [ ] 1.4 Fail-fast on missing env vars
- [ ] 1.5 Add rate limiting middleware
- [ ] 1.6 Stream file uploads instead of buffering
- [ ] 1.7 Fix ASR Python sidecar blocking

### Phase 2: Scalability & Performance (Day 2)
- [ ] 2.1 Fix N+1 query in `/api/channels`
- [ ] 2.2 Fix N+1 query in `/api/unread`
- [ ] 2.3 Add search to "Start DM" dialog
- [ ] 2.4 Add infinite scroll for messages
- [ ] 2.5 Bound Service Worker API cache
- [ ] 2.6 Add music cache eviction
- [ ] 2.7 Wrap multi-step writes in transactions
- [ ] 2.8 Fix `useSocket` listener leak

### Phase 3: Security Hardening (Day 3)
- [ ] 3.1 Session management — device tracking & force logout
- [ ] 3.2 Multi-device push subscriptions
- [ ] 3.3 Input validation sweep (Zod schemas)
- [ ] 3.4 Security headers middleware
- [ ] 3.5 Bind ASR/TTS to localhost
- [ ] 3.6 Remove `ignoreBuildErrors` (DONE)

### Phase 4: Code Quality & Architecture (Day 4)
- [ ] 4.1 Extract bot framework helpers (eliminate duplication)
- [ ] 4.2 Split realtime-server into modules
- [ ] 4.3 Move `typingTimers` to module scope
- [ ] 4.4 Replace console.log with pino logger
- [ ] 4.5 Remove dead code & unused dependencies
- [ ] 4.6 Enable React StrictMode
- [ ] 4.7 Reduce Prisma logging

### Phase 5: UX Polish (Day 5)
- [ ] 5.1 Add skeleton loaders
- [ ] 5.2 Add global search / command palette
- [ ] 5.3 Add image caching for thumbnails
- [ ] 5.4 Fix stories query to filter in DB
- [ ] 5.5 Clean up `.env` and `.gitignore`

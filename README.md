# Adoo — Friends Social

A modern, feature-rich social media web app designed for small friend groups (8–15 people). Built with Next.js 16, Socket.io, WebRTC, Prisma, and a cinematic 3D theme. Deployable on a single port behind Cloudflare Tunnel.

---

## ✨ Features

### 💬 Chat System
- **DM & Group Channels** — Discord-style server rail with groups, text/voice/video channels
- **Real-time messaging** via Socket.io with typing indicators, read receipts, and presence
- **Message replies, editing, deletion** with soft-delete tombstones
- **Media sharing** — images and videos with client-side compression
- **Custom context menus** — right-click or long-press for reply/copy/edit/delete
- **Smart scroll** — auto-scrolls to bottom on new messages, respects manual scroll position
- **Deleted user handling** — shows "Deleted User" for accounts that no longer exist

### 🎵 Musical — Synced Music Streaming
- **YouTube Music search & trending** via `youtubei.js`
- **Audio extraction** via `yt-dlp` + `ffmpeg` with disk caching and HTTP Byte-Range streaming
- **Listening rooms** — host-authoritative synced playback with real-time Socket.io sync
  - Drift compensation (>1.5s threshold)
  - Network delay adjustment using server timestamps
  - Full queue broadcasting
  - Join sync — new members get the host's current position instantly
- **Queue management** — shuffle, repeat, autoplay (YouTube recommendations)
- **Global persistent player** — draggable floating mini-player that persists across all tabs
- **Collapsible** — tap to expand full controls, tap to collapse to a floating circle
- **Related tracks** — autoplay uses YouTube's "Up Next" recommendations

### 📞 Voice & Video Calls
- **WebRTC mesh topology** with perfect negotiation pattern
- **DM calls** — ring the partner directly (rings via Socket.io + push notification)
- **Voice/video channels** — persistent channel calls (join/leave anytime)
- **VP8 codec preference** for Firefox Android compatibility
- **RNNoise neural noise suppression** via AudioWorklet
- **Screen sharing** (desktop only)
- **Call sounds** — synthesized via Web Audio API (ringback, incoming, connected, ended)
- **TURN providers** — Google STUN (always), Metered TURN (private), Cloudflare TURN (optional)
- **P2P/TURN indicator** — shows connection type during calls
- **Call history** with incoming/outgoing/missed indicators
- **Distinct voice vs video call UIs** — voice has avatar with pulsing rings + audio waveform; video has full-screen grid

### 📸 Status Stories
- **24-hour ephemeral stories** with image/video support
- **Client-side image compression** — Canvas API, 1280px max, 82% JPEG quality
- **Viewer list and privacy tiers** (all/include/exclude)
- **Animated progress bars** via requestAnimationFrame
- **Auto-advance** with 5-second timer per story

### 🤖 Bot System
- **Visual bot builder** — standalone full-screen tab at `/bot-builder/[id]`
- **12 node types** across 5 categories:
  - **Triggers**: Trigger (any message / command / mention)
  - **Output**: Send Message, Typing Pause
  - **Input**: Wait for Reply, Wait for Choice (pauses flow, stores reply in variable)
  - **Logic**: Condition (TRUE/FALSE branches), Set Variable, Delay, Stop
  - **Advanced**: API Call, Random Branch
- **Pause/resume engine** — input nodes pause flow execution, persist state to `ConversationSession`, and resume on the user's next message
- **Variable interpolation** — `{{sender}}`, `{{body}}`, `{{args}}`, `{{varName}}`
- **Session management** — bot sessions cleared on flow save to prevent stale state
- **Bundled bots** — echo, help, poll, remind (code-based) + visual (flow-based)
- **Bot dispatch** — deduplicated per-message, supports commands, mentions, and visual bot triggers

### 🗣️ TTS Voice Messages (Pocket TTS)
- **AI voice generation** via Kyutai Pocket TTS
- **10+ pre-built voices** (Alba, Charles, Jane, Michael, Vera, Paul, etc.)
- **Custom voice cloning** — record or upload a voice clip, create a custom voice model
- **Safetensors optimization** — voices are exported to `.safetensors` format for fast inference (10x+ faster than raw audio)
- **WAV conversion** — non-WAV audio (webm/mp3) is converted to WAV via ffmpeg before sending to Pocket TTS
- **Audio message rendering** — gradient icon + audio player in chat

### 🔔 Notifications
- **Rich toast notifications** — sender avatar, channel/group context, mention badges
- **Click-to-open** — clicking a notification navigates to the conversation
- **Web push notifications** via VAPID + service worker (for background notifications)
- **Call notifications** — shows caller name and call type (voice/video)
- **Message sound** — subtle notification sound on new messages

### 📱 PWA & Offline
- **Service Worker v5** — app shell caching, network-first navigations
- **Update banner** — detects new builds via version polling (not just SW changes)
  - Polls `/api/version` every 60 seconds (compares Next.js BUILD_ID)
  - Also checks SW updates and on tab visibility change
  - Shows "Update available" banner with reload button
- **Manifest** with display_override, launch_handler, shortcuts
- **Custom context menus** — browser right-click disabled globally, replaced with app-specific menus

### 🎨 Theme & UI/UX
- **Cinematic 3D dark theme** — deep navy-black base, electric blurple accents
- **React Bits components** — SpotlightCard, GlassSurface, GradientText, ShinyText, BorderGlow, StarBorder
- **Glassmorphism** — layered frosted glass surfaces with inner highlights and diffuse shadows
- **Animated aurora mesh** background on every screen
- **Mesh gradient** backgrounds for hero/empty states
- **Glow effects** — primary, success, danger glows
- **Spring animations** via Framer Motion
- **Discord-style server rail** — single sidebar with DMs, server icons, bottom nav, user avatar
- **Mobile slide-out drawer** for server rail
- **Responsive** — mobile-first with bottom nav, desktop with server rail

### ⚙️ Admin & Group Management
- **Discord-like groups** with text, voice, and video channels
- **Group roles** — owner, admin, member (via `GroupMember` model)
- **Channel management** — create, delete, rename channels (owner/admin)
- **Member management** — promote/demote admins, kick members (owner)
- **Invite system** — invite codes with easy copy from group settings
- **Admin panel** — manage users, groups, bots

---

## 🏗️ Architecture

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| Database | Prisma + SQLite (PostgreSQL migration path) |
| Realtime | Socket.io (same port as Next.js) |
| WebRTC | Custom CallManager (singleton, perfect negotiation) |
| State | Zustand (app, call, music stores) |
| Server State | TanStack Query |
| UI | Tailwind CSS 4 + shadcn/ui (OKLCH color space) |
| Animation | Framer Motion |
| Fonts | Geist Sans + Geist Mono |
| Audio | Web Audio API (call sounds), RNNoise (noise suppression) |
| Music | youtubei.js (metadata), yt-dlp + ffmpeg (extraction) |
| TTS | Pocket TTS (Kyutai) with safetensors voice cloning |
| PWA | Service Worker v5, VAPID web push |

### Single-Port Architecture
Next.js and Socket.io share port 3090 via a custom `server.ts`. This enables Cloudflare Tunnel hosting on a single port — no multi-port tunneling needed.

### Project Structure
```
src/
├── app/
│   ├── api/                    # API routes (42 endpoints)
│   │   ├── auth/               # NextAuth (register, me, [...nextauth])
│   │   ├── bots/               # Bot CRUD + flow management
│   │   ├── calls/              # Call lifecycle, ICE servers, history, pending
│   │   ├── channels/           # Channel CRUD, messages, members, read receipts
│   │   ├── groups/             # Group CRUD, channels, members
│   │   ├── music/              # Search, trending, stream, rooms, related, debug
│   │   ├── stories/            # Story CRUD
│   │   ├── tts/                # TTS generation + custom voice management
│   │   ├── users/              # User profile management
│   │   ├── version/            # Build version (for update detection)
│   │   └── admin/              # Admin-only endpoints
│   ├── bot-builder/[id]/       # Standalone bot builder page (full-screen)
│   ├── layout.tsx              # Root layout with ContextMenuProvider
│   └── page.tsx                # App entry (AppShell)
├── components/
│   ├── auth/                   # Login/signup screen
│   ├── bots/                   # Bot builder editor (React Flow)
│   ├── chat/                   # Chat view, message list, composer, server rail
│   ├── layout/                 # App shell, navigation, update banner
│   ├── music/                  # Music view, global music player
│   ├── reactbits/              # React Bits components (pure CSS)
│   ├── settings/               # Settings view (profile, privacy, bots, admin)
│   ├── status/                 # Status stories view
│   ├── ui/                     # shadcn/ui components
│   └── voice/                  # Call screens, controller, incoming overlay
├── hooks/                      # React hooks (socket, channel, calls, etc.)
├── lib/                        # Core libraries
│   ├── bot/                    # Bot framework + flow engine
│   ├── avatar.ts               # DiceBear avatar generation
│   ├── call-manager.ts         # WebRTC singleton
│   ├── call-sounds.ts          # Web Audio API call sounds
│   ├── chat-utils.ts           # Channel utilities
│   ├── db.ts                   # Prisma client
│   ├── image-compress.ts       # Canvas-based image compression
│   ├── push.ts                 # VAPID web push
│   ├── realtime-server.ts      # Socket.io server (chat, presence, calls, music sync)
│   ├── turn.ts                 # TURN provider configuration
│   └── youtube.ts              # youtubei.js cached instance + utilities
├── stores/                     # Zustand stores
│   ├── useAppStore.ts          # View, active channel, selected group, reply state
│   ├── useCallStore.ts         # Call state
│   └── useMusicStore.ts        # Music playback state
└── scripts/
    ├── backfill-group-members.ts  # Backfill GroupMember for existing groups
    └── setup-ytdlp.sh             # Install yt-dlp, Deno, EJS, PO Token provider
```

### Database Schema
| Model | Purpose |
|-------|---------|
| User | Users with roles (owner/admin/member), presence, privacy prefs |
| Group | Groups (isDm flag for DMs) |
| GroupMember | Group-level roles (owner/admin/member) |
| Channel | Text/voice/video channels within groups |
| ChannelMember | Channel-level membership |
| Message | Messages with polymorphic sender, replies, media, soft-delete |
| MessageReadReceipt | Read receipts |
| Bot | Bot definitions with flow JSON |
| ConversationSession | Bot conversation state (pause/resume) |
| Story | 24h ephemeral stories |
| StoryViewer / StoryAudience | Story viewers and privacy |
| VoiceCall | Call records (DM + channel) |
| CallParticipant | Call participants |
| MusicRoom | Synced music rooms |
| MusicRoomMember | Music room members |
| CustomVoice | User-created TTS voice models (with safetensors) |
| UserSetting | Per-user settings |
| Account / Session / VerificationToken | NextAuth |

### Real-time Events (Socket.io)
| Event | Direction | Purpose |
|-------|-----------|---------|
| `channel:join/leave` | Client→Server | Subscribe to channel messages |
| `channel:message` | Bidirectional | Real-time message relay |
| `channel:message-edit/delete` | Bidirectional | Message edits and deletions |
| `channel:typing` | Bidirectional | Typing indicators |
| `call:offer/answer/ice-candidate` | Peer→Peer | WebRTC signaling |
| `call:ring` | Client→Client | DM call ringing |
| `call:peer-joined/left` | Server→Client | Call participant changes |
| `music:join/leave` | Client→Server | Join music room socket channel |
| `music:sync` | Host→Members | Broadcast playback state (track, position, play/pause, queue) |
| `music:request-sync` | Member→Host | Request current state (on join) |
| `music:member-joined` | Server→Room | Notify room of new member |
| `presence:set/request` | Bidirectional | Online/idle/dnd/offline status |
| `notify` | Server→Client | Push notification to other devices |

---

## 🚀 Setup

### Prerequisites
- Node.js 18+ (or Bun)
- Python 3.11+ (for yt-dlp and Pocket TTS)
- ffmpeg

### Installation
```bash
# Clone
git clone https://github.com/Chandima-Prabhath/SNS.git
cd SNS

# Install dependencies
npm install

# Copy env file and fill in values
cp .env.example .env

# Generate Prisma client and push schema
npx prisma db push

# Run development
npm run dev

# Production build
npm run build
npm start
```

### Environment Variables
See `.env.example` for all variables. Key ones:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite or PostgreSQL URL |
| `NEXTAUTH_SECRET` | Yes | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Yes | Your domain (e.g. `https://sns.example.com`) |
| `PORT` | Yes | Server port (default: 3090) |
| `VAPID_PUBLIC_KEY` | Optional | Web push notifications |
| `VAPID_PRIVATE_KEY` | Optional | Web push notifications |
| `TTS_URL` | Optional | Pocket TTS server URL (default: `http://localhost:8000`) |
| `YTDLP_COOKIES_PATH` | Optional | Path to cookies.txt for yt-dlp |
| `METERED_TURN_USERNAME` | Optional | Private TURN credentials |
| `METERED_TURN_CREDENTIAL` | Optional | Private TURN credentials |

### Musical Feature Setup (yt-dlp)
YouTube has aggressive anti-bot measures. Run the setup script:
```bash
chmod +x scripts/setup-ytdlp.sh
./scripts/setup-ytdlp.sh
```
This installs:
- **yt-dlp** (latest, with `[default]` extras including `yt-dlp-ejs`)
- **Deno** (JS runtime for YouTube signature extraction)
- **bgutil-ytdlp-pot-provider** (PO Token generator, auto-started on port 4416)
- **ffmpeg** (audio conversion)

For cookies (recommended): export from a private browser window using "Get cookies.txt LOCALLY" extension, save as `cookies.txt`, and set `YTDLP_COOKIES_PATH=./cookies.txt` in `.env`.

### Pocket TTS Setup
1. Install Pocket TTS: `pip install pocket-tts[default]`
2. Start the server: `pocket-tts serve --port 8000`
3. Set `TTS_URL=http://localhost:8000` in `.env`

Custom voices are exported to `.safetensors` format automatically for fast inference.

### Cloudflare Tunnel
```bash
# Install cloudflared
cloudflared tunnel --url http://localhost:3090
```

---

## 🧪 Development

```bash
# Development with hot reload
npm run dev

# Type check
npx tsc --noEmit

# Lint
npm run lint

# Build
npm run build

# Database
npx prisma db push      # Push schema changes
npx prisma studio       # Visual database browser
npx prisma generate     # Regenerate client
```

---

## 📦 Production Deployment

```bash
# Build
npm run build

# Start (uses custom server.ts with Socket.io on same port)
npm start

# Or use the start/stop scripts
./start.sh
./stop.sh
```

### Update Detection
The app uses a dual update detection mechanism:
1. **Service Worker** — detects SW file changes
2. **Version polling** — polls `/api/version` every 60 seconds, compares `BUILD_ID`

When an update is detected, users see an "Update available" banner. Clicking "Update" reloads the page.

---

## 🔮 Future Plans

### Planned Features
- **Disappearing messages** — TTL-based message expiration (schema field exists, UI not built)
- **Message search** — full-text search across channels
- **Voice messages** — record and send voice clips (beyond TTS)
- **Music playlists** — save and share curated playlists
- **Group video calls** — multi-party video via SFU
- **File sharing** — documents, PDFs, archives
- **Custom themes** — user-selectable color schemes
- **Keyboard shortcuts** — navigate without mouse
- **E2E encryption** — optional encrypted DMs
- **Mobile apps** — React Native or Capacitor wrapper

### Tech Debt & Improvements
- Migrate from SQLite to PostgreSQL for production
- Implement proper Prisma migrations (currently using `db push`)
- Add automated testing (Jest, Playwright)
- Add CI/CD pipeline
- Optimize bundle size (code splitting, lazy loading)
- Add rate limiting to API routes
- Implement proper logging (Winston/Pino)

---

## 📄 License

Private project. Not for redistribution.

---

## 🤝 Contributors

Built with care for a small friend group. Designed to be modular, maintainable, and fun.

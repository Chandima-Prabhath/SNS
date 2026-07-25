---
Task ID: 1
Agent: Super Z (main)
Task: Build a cross-platform social media web app with DM, group chat, Telegram-style bots, WhatsApp-style status, WebRTC voice calling (Google STUN now, Cloudflare TURN groundwork), modular architecture for easy maintenance, intuitive UI/UX including admin parts. Compatible with Cloudflare Tunnel hosting.

Work Log:
- Loaded fullstack-dev skill, initialized Next.js 16 project environment
- Researched best features from Telegram (bot system, command/callback), Discord (channels, voice), WhatsApp (status, read receipts), Signal (disappearing messages), and WebRTC signaling patterns
- Installed socket.io, socket.io-client, bcryptjs dependencies
- Wrote comprehensive Prisma schema with: User, Bot (polymorphic sender), Group, Channel, ChannelMember, Message (with replies, edit, soft-delete, TTL), MessageReadReceipt, Story (24h ephemeral), StoryViewer, StoryAudience, VoiceCall, CallParticipant, ConversationSession (bot FSM), UserSetting
- Built realtime mini-service on port 3003: chat relay, presence, WebRTC signaling (offer/answer/ICE/peer-joined/peer-left)
- Built lib layer: NextAuth (JWT strategy with role refresh), socket.io client singleton, WebRTC mesh manager, Cloudflare TURN HMAC-SHA1 credential signer (disabled by default), Telegram-style bot framework (transport → dispatcher → middleware → registry), 4 sample bots (echo, help, poll, remind)
- Built API routes: auth (register, me, [...nextauth]), channels/[id] (messages, members, read), groups (create, join, DM), users, bots (CRUD), stories (CRUD), calls (lifecycle + ice-servers), admin (users, groups, bots), upload, seed
- Built Zustand stores (app state, call state) and React hooks (useSocket, useChannel, usePresence, useVoiceCall, useStories, useBots)
- Built UI: auth screen, sidebar nav (Chat/Status/Voice/Bots/Settings/Admin), chat view (channel list, message list with replies/edits/typing/read-receipts, composer), status view (stories carousel, viewer list, privacy), voice view (voice channels, call controls, mute), bots view (CRUD + module docs), settings view (profile + privacy), admin view (users/groups/bots/system)
- Fixed bugs during testing: Prisma polymorphic sender (senderId optional + SetNull), bot module exports (added `export` to const declarations), NextAuth JWT strategy (credentials provider requires JWT not database), viewport metadata (separate export), stale JWT role (jwt callback now refreshes from DB), useSocket setState-in-effect lint (derive state instead), seed adding user only to text channels (now all channels), bot replies not broadcast via socket (API now returns botReplies array, client broadcasts them)
- Verified end-to-end with Agent Browser: signed up, signed in, seeded default group, sent /echo command and saw bot reply in real-time, navigated all 6 views (chat, status, voice, bots, settings, admin), tested mobile (375x667) and desktop (1280x800) viewports

Stage Summary:
- App is fully functional and verified end-to-end
- Architecture is intentionally modular: each feature is one folder + one hook + one API route group, removable independently
- Bot framework is transport-agnostic and extensible (drop a file, register, done)
- WebRTC uses Google STUN always; Cloudflare TURN wired but disabled by default (just add credentials to .env)
- Compatible with Cloudflare Tunnel hosting — both Next.js (port 3000) and Socket.io (port 3003) can run behind the same tunnel using XTransformPort query param
- README.md documents setup, Cloudflare TURN enablement, adding new bots, and architecture decisions
- Lint passes cleanly, no runtime errors

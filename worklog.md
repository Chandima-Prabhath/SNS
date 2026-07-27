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

---
Task ID: bot-builder-v2
Agent: Super Z (main)
Task: Redesign the visual bot builder. The user reported: all nodes look like message nodes, input nodes don't wait for replies, clicking the default node crashes the client, and the builder is primitive. Need to make it intuitive, versatile, and logical.

Work Log:
- Investigated existing bot system via Explore agent — found 10 distinct bugs:
  1. CustomNode read `type` prop (always 'custom') instead of `data.type` — caused every node to render as a green Send Message node
  2. Default node's `.map()` overwrote `data.type` with ReactFlow's `type: 'custom'` — caused inspector crash on click
  3. Input node did NOT wait for user reply — just pushed the prompt and fell through to the next edge
  4. Engine had no pause/resume mechanism — `variables: {}` was fresh on every message, so even if input paused, state would be lost
  5. Double-dispatch in messages route — visual bots fired twice on /cmd@botname and on @mentions
  6. Default trigger with empty command matched on every message
  7. Inspector header dereferenced `def` without null-check
  8. New nodes positioned off-screen for large flows
  9. Unused imports in editor
  10. API 500s in production (likely Prisma schema drift — `Bot.flow` column missing in prod DB)

- Rewrote `src/lib/bot/flow-types.ts` (565 lines):
  - Expanded from 6 → 12 node types across 5 categories:
    * trigger: Trigger (any_message / command / mention subtypes)
    * output: Send Message, Send Choices, Typing Pause
    * input: Wait for Reply (pauses), Wait for Choice (pauses + validates)
    * logic: Condition (TRUE/FALSE branches), Set Variable, Delay, Stop
    * advanced: API Call, Random Branch (multi-output)
  - Added `NodeDef` catalog with color, icon, category, handles layout, isStart, pauses, terminates flags
  - Added `defaultNodeData()` factory for sensible starting state per type
  - Added `ResumeDescriptor` type for the pause/resume mechanism
  - Engine returns `{ sentCount, paused, pausedAtNodeId, variables }` instead of just `messages`
  - Engine supports `resume` parameter to skip the trigger and continue from a saved node
  - Added {{body}} interpolation alongside existing {{sender}}, {{args}}, {{varName}}

- Rewrote `src/lib/bot/bots/visual.ts` (165 lines):
  - Loads ConversationSession state via `ctx.getState()` at the start of every message
  - If session has `pausedAt`, treats the incoming message as the awaited reply:
    * For `wait_choice` nodes: validates the reply against the options list (by index or text), re-prompts on invalid input, stays paused
    * For `input` nodes: stores the message body in the input variable and resumes from the next node
  - Persists `{ pausedAt, variables }` to ConversationSession after every run via `ctx.setState()`
  - Clears session when the flow completes or errors

- Rewrote `src/components/bots/bot-builder-editor.tsx` (700+ lines):
  - Fixed the CustomNode component to read `data.type` (the FlowNode type) instead of the ReactFlow `type` prop (always 'custom') — fixes "all nodes look the same" bug
  - Default new bot now ships with a Trigger + Send Message node pre-connected (no more clicking-into-the-void crash)
  - Each node type has a distinct visual identity:
    * Color-coded header bar (purple trigger, green outputs, red inputs, yellow logic, cyan advanced)
    * Unique icon per type (Zap, Send, ListChecks, Loader, Keyboard, MousePointerClick, GitBranch, Variable, Clock, Square, Webhook, Shuffle)
    * Body shows context-specific preview (e.g. condition shows "var operator value", api_call shows "METHOD url", etc.)
    * Badges for "pause" and "end" nodes
    * TRUE/FALSE split handles for condition nodes
    * Multi-output indicator for random nodes
  - Node palette grouped by category (Triggers, Output, Input, Logic, Advanced)
  - Inspector shows contextual help per node type (e.g. explains pause behavior for input nodes, TRUE/FALSE handles for condition)
  - Added live validation warnings: missing trigger, multiple triggers, orphaned nodes
  - Added OptionsEditor component for choice/wait_choice nodes (add/remove/edit options inline)
  - Added VariableNameField component with {{varName}} preview
  - Added EmptyInspector state with quick tips
  - Added toolbar showing node/edge counts and warning count
  - MiniMap now colors nodes by their type
  - Edges have arrow markers and animated flow
  - Better node positioning when adding (cascade from top-center, always visible)
  - Clear All button with confirmation

- Fixed double-dispatch in `src/app/api/channels/[id]/messages/route.ts`:
  - Replaced the three overlapping dispatch paths (commands / mentions / always-visual) with a single unified pass
  - Builds a `Map<botId, isMention>` so each bot fires at most once per message
  - Per-bot decision: command with @target → only named bot; command without @target → all bots; @mention → mentioned bot; plain message → visual bots only
  - Visual bots still receive every message (so their trigger node can decide), but no longer receive duplicate dispatches

Stage Summary:
- All 4 user-reported issues are now fixed:
  1. Nodes have distinct visual styles — color, icon, body preview, handles all vary by type
  2. Input nodes actually pause and wait for the next message (state persisted in ConversationSession)
  3. New bots start with a Trigger + Message node pre-wired — no more crash on click
  4. Builder is now intuitive: categorized palette, contextual inspector help, live validation, distinct node shapes
- 12 node types cover the common bot patterns: branching, looping, async input, API calls, randomness
- Engine is logical: trigger → walk graph → pause on input → resume on next message → clear state on completion
- Build passes cleanly (`next build` succeeds, all 5 bot modules load)
- Production 500 errors on /api/bots still need `bun run db:push` on the prod database (Bot.flow column likely missing)

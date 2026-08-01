# Chat UX Research: Read Receipts, Bot Indicators, Composer & Emoji

**Scope:** Best practices for a WhatsApp/Telegram-style chat app, grounded in
the existing Adoo codebase (`/home/z/my-project`). Each section covers what
the top apps do, what Adoo already has, what's missing, and the recommended
implementation approach for a small friend-group app.

**Key finding up front:** Adoo's schema and bot framework already implement
most of the *hard* parts correctly (hybrid read-receipt schema, `channel:read`
socket event, `User.readReceiptsEnabled` privacy toggle, bot `setTyping`
helper). The gaps are mostly UI rendering, a `deliveredAt` timestamp, draft
persistence, and an emoji picker. This doc focuses on closing those gaps.

---

## 1. Read Receipts

### 1.1 What the top apps do

#### WhatsApp — 4 states, tick-based
WhatsApp uses a single checkmark glyph that accumulates:

| State | Visual | Meaning |
|---|---|---|
| **Sending** | 🕐 clock | Message is on the sender's device, not yet on the server |
| **Sent** | ✓ single gray | Reached WhatsApp's server |
| **Delivered** | ✓✓ double gray | Pushed to the recipient's device (FCM/APNs ack) |
| **Read** | ✓✓ double blue | Recipient opened the chat (not necessarily read the words) |

Key semantics from the WhatsApp Help Center and community research:
- Only the **two blue ticks** are the actual "read receipt." Everything
  before that is *delivery*, not reading.
- "Read" = the chat was opened with the message visible. It does **not**
  guarantee a human read the words — only that the conversation was opened.
- In **group chats**: the second gray tick appears when *everyone has
  received* the message; two blue ticks appear when *everyone has read* it.
  Long-pressing a message reveals a per-recipient "Read by" list with
  timestamps.
- Read receipts **reset on edit** — editing a message clears the blue ticks
  so the sender can see who viewed the update.
- Users can disable read receipts in Settings → Privacy. If you disable
  them, you also can't see others' receipts (symmetric).

#### Telegram — different model
Telegram is deliberately different:

- **1:1 DMs:** two checks (✓✓) once the recipient has *read* the message.
  There is no separate "delivered" tick shown to the user — the single
  check (✓) means "sent to server," and ✓✓ means "read." The "delivered"
  state is hidden from the UI.
- **Groups:** messages are marked read (✓✓) as soon as **any** member reads
  them. Telegram does **not** show per-member read state in the message UI
  for large groups — at 200k members, per-read tracking is too expensive
  (confirmed by Telegram's own bug tracker). Instead, the read count is
  shown as a small badge (e.g. "3/8") on the message for small groups.
- **Read without opening:** marking a chat "as read" from the chat list
  *does* send a read receipt. To preview without sending a receipt, you
  must long-press to open the preview window.
- **Bots:** Telegram bots **do not receive or send read receipts**. The bot
  API has no "read" concept. Instead, bots use `sendChatAction` with
  `"typing"` to signal activity (see §2).

#### Discord — read states, no ticks
Discord doesn't show tick marks at all. Instead it uses an **unread
divider line** ("New") in the message stream and a channel-level unread
badge. Per-message read receipts are not a Discord concept. This is the
opposite end of the spectrum from WhatsApp — good for high-throughput
servers, less good for a small friend group that values "did they see it?"

### 1.2 DB schema pattern — what Adoo already has

Adoo's schema uses the **hybrid pattern**, which is the best-practice
approach. From `prisma/schema.prisma`:

```prisma
// Pattern 1: per-message-per-user receipt row (full read history)
model MessageReadReceipt {
  id        String   @id @default(cuid())
  messageId String
  userId    String
  readAt    DateTime @default(now())
  message   Message  @relation(...)
  user      User     @relation(...)
  @@unique([messageId, userId])   // ← one receipt per (message, user)
  @@index([userId])
}

// Pattern 2: high-water pointer on membership (for unread-count calc)
model ChannelMember {
  ...
  lastReadMessageId String?   // ← the newest message this user has read
  @@unique([channelId, userId])
}

// Pattern 3: privacy toggle
model User {
  readReceiptsEnabled Boolean @default(true)
}
```

**Why both patterns?** They serve different queries:
- `lastReadMessageId` makes unread-count calculation a single indexed
  comparison (`WHERE m.id > member.lastReadMessageId` or rowid > pointer)
  — O(1) per channel, no joins. This is what powers `/api/unread` and the
  chat-list badge. WhatsApp/Telegram use this pattern internally.
- `MessageReadReceipt` gives you the per-recipient "Read by 3 people at
  14:23" detail view (long-press → info screen). The `@@unique` constraint
  makes `upsert` idempotent — the existing `/api/channels/[id]/read/route.ts`
  already uses this correctly.

The three alternative schema patterns and why they're worse:

| Pattern | Pro | Con |
|---|---|---|
| Timestamp on message (`readAt`) | Simple | Only tracks one reader — breaks for groups |
| `read: Boolean` on a join table | Simple | Loses the *when*; no "read at 14:23" |
| **Hybrid (Adoo's choice)** | Fast unread + detailed history | Two tables to keep in sync |
| Single receipts table only | One source of truth | Unread count = `COUNT(*)` per channel — slow at scale |

**Recommendation: keep the current schema.** It's correct.

### 1.3 What's missing — the "delivered" state

Adoo currently has **sent** (message row created) and **read**
(`MessageReadReceipt`), but no **delivered** state. WhatsApp's double-gray
ticks are the single most-requested chat feature, and the gap is noticeable:
a user sees nothing between "I hit send" and "they read it."

**Recommended addition** — one nullable timestamp on `Message`:

```prisma
model Message {
  ...
  deliveredAt DateTime?   // when the message was pushed to a recipient device
  readAt      DateTime?   // denormalized: MAX(readReceipts.readAt) — optional, for fast UI
  ...
}
```

**Delivered semantics — the key design decision:**

The research surfaced a common confusion: is "delivered" when the message
reaches the **server**, or when it reaches the **recipient's device**?

WhatsApp's answer (per WhatsApp Help Center + community): **delivered =
reached the recipient's device**, confirmed via push ACK (FCM/APNs delivery
receipt) or via the recipient's socket connection acknowledging receipt. The
server having the message is the *sent* state (single gray tick).

For Adoo (Socket.IO-based, small group), the cleanest mapping is:

| Adoo state | DB field | Socket event | WhatsApp equivalent |
|---|---|---|---|
| Sent | `message.createdAt` (row exists) | `channel:message` (broadcast) | ✓ single gray |
| Delivered | `message.deliveredAt` | `channel:delivered` | ✓✓ double gray |
| Read | `MessageReadReceipt` row + `readAt` | `channel:read` (exists) | ✓✓ double blue |

**How to set `deliveredAt`:** When the server emits `channel:message` to a
recipient's socket, have the recipient's client emit a `channel:delivered`
ack back. This mirrors WhatsApp's device-level ACK and is more honest than
marking delivered at server-broadcast time (the client may be offline with
the socket buffered). For a small friend group, a simpler approximation —
mark delivered when the recipient's socket is connected at send time — is
acceptable and avoids a round-trip. Pick based on how honest you want to be.

### 1.4 Real-time broadcast — what Adoo has

Adoo already broadcasts read receipts correctly:

```ts
// src/lib/realtime-server.ts:271
socket.on('channel:read', (payload: { channelId: string; messageId: string }) => {
  socket.to(`channel:${payload.channelId}`).emit('channel:read', {
    userId, channelId: payload.channelId, messageId: payload.messageId,
  })
})
```

And the client (`src/hooks/useChannel.ts:156`) patches the read receipt into
the message's `readReceipts[]` array optimistically. This is the right
pattern.

**Recommended additions:**
1. Add a parallel `channel:delivered` event (mirror the read handler).
2. The `channel:read` handler currently only broadcasts to sockets in the
   channel *room*. For the chat-list "read by" indicator to update in real
   time when the user is viewing a *different* channel, fan out to all
   channel members via the presence map — exactly as you already do for
   `channel:typing` (see `realtime-server.ts:247-265`). Reuse that pattern.

### 1.5 Group chats — per-member read state

WhatsApp shows ✓✓ blue only when **all** members have read; the long-press
"Info" screen shows each member's read timestamp individually.

Adoo's `MessageReadReceipt` table already supports per-member tracking.
The rendering logic should be:

- **Bubble footer for own message in a group:**
  - 0 receipts → ✓✓ gray (delivered) or ✓ (sent only)
  - 1..N-1 receipts → ✓✓ gray + small "N/M" badge (optional, Telegram-style)
  - all N receipts → ✓✓ blue
- **Long-press → Info sheet:** list each member with avatar + "Read at
  14:23" or "Delivered" or "Sent". Query: `MessageReadReceipt` joined to
  `ChannelMember` for the full member list (left join so non-readers show up).

For a small friend group (8-15 people), per-member read state is both
feasible and expected. Don't skip it.

### 1.6 Bots — should bot messages show read receipts?

**No.** This is consistent across WhatsApp Business, Telegram bots, and
Discord bots. Reasons:
- Bots don't have a "chat opened" event — they process messages via webhook
  the instant they arrive. A "read" receipt would fire instantly and
  convey no information.
- Bot-to-user messages don't need read receipts because the bot doesn't
  care whether you read its reply.
- The user reading a bot's reply is tracked for **unread badge** purposes
  (so the channel stops showing bold), but **not** shown as a tick on the
  bot's message.

**Adoo implementation:** when rendering receipts, skip the sender's own
messages where `senderType === 'bot'`. The unread badge logic (which uses
`lastReadMessageId`) is unaffected — it's about the user's read position,
not the sender's.

Conversely, when a **user** messages a bot, should the user see "the bot
read my message"? See §2.

---

## 2. Bot Interception Indicator

### 2.1 What the top apps do

#### Telegram
- **No read receipts for/from bots.** The Bot API has no read concept.
- Bots signal activity via `sendChatAction(chat_id, "typing")`, which shows
  a **"Bot is typing..."** indicator in the chat header/composer area for
  ~5 seconds. This is the *only* visual feedback that the bot received and
  is processing the message.
- The Telegram Bot API community confirms bots cannot show online status;
  `sendChatAction("typing")` is the sanctioned mechanism.
- Known bug class: if a bot re-emits typing on an interval and then stops
  without letting it expire, the indicator persists ("typing forever").
  Telegram clients auto-clear after ~5s of no refresh — the bot must keep
  re-emitting every few seconds for long operations.

#### Discord
- Same model: bots call `POST /channels/{id}/typing` to trigger the
  "Bot is typing..." indicator under the channel name.
- Discord's typing indicator fires whenever the chat bar content *changes*,
  and auto-stops ~10s after the last update. Bots replicate this by
  re-POSTing typing every ~8s during long operations.
- Discord does **not** show a checkmark on the user's message when a bot
  processes it. The typing indicator is the entire feedback loop.
- Some Discord bots add a **reactions-based** ack: the bot reacts to the
  user's command message with a ⏳ emoji while processing, then swaps to ✅
  on completion. This is a community pattern, not a platform feature.

#### Slack
- Slack bots show "typing…" the same way.
- Slack also has the **reactions-ack** pattern (bot adds ⏳ then ✅).
- Slack slash-commands return an immediate `200` with an optional
  `response_type: "ephemeral"` ack message.

### 2.2 Recommended approach for Adoo

**The bot typing indicator is the right primitive, and Adoo already has it.**
From `src/lib/bot/framework.ts:91-94`:

```ts
/** Show a "Bot is typing..." indicator in the channel for `seconds`.
 *  Used by long-running nodes (TTS, ASR, LLM, API) to give the user
 *  visual feedback that the bot is working on their request. */
setTyping?: (seconds: number) => Promise<void>
```

And the implementation (`framework.ts:302-320`) re-emits every 4 seconds
(Telegram-style) until the timeout expires — exactly the right pattern,
avoiding the "typing forever" bug.

**What's missing:** the typing indicator currently fires only inside
long-running bot nodes. For a true "bot saw my message" feel, fire
`setTyping` **immediately when the bot receives the message**, before
processing begins — even if the bot will respond in 200ms. This gives the
user a visible "the bot got it" signal.

Recommended change in the bot dispatch path (conceptual):

```ts
// In dispatchBotUpdate, immediately after matching the bot:
if (bot.privacyMode === false || matchesCommand || isMentioned) {
  ctx.setTyping?.(2)   // brief "ack" typing pulse, even for fast replies
}
// ... then run the handler ...
await handler(ctx)
```

### 2.3 Checkmark on the user's message vs. typing indicator vs. system message

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Checkmark on user's message** ("bot read it") | Matches WhatsApp mental model | Misleading — bots don't "read," they process. Implies a human action. | ✗ Don't |
| **"Bot is typing…" indicator** (Telegram/Discord model) | Honest, standard, already built | Disappears after the bot replies | ✓ **Recommended** |
| **Separate system message** ("Bot received your message") | Explicit | Clutters the chat; no real app does this | ✗ Don't |
| **Reactions-ack** (⏳ then ✅ on the user's message) | Persistent, visible in scrollback | Non-standard; can look noisy | ◐ Optional, only for long ops (>3s) |

**Recommendation:** Use the typing indicator as the primary ack. For
operations that take >3 seconds (LLM calls, TTS, ASR), *additionally*
react to the user's message with ⏳ and swap to ✅ on completion — this
gives persistent feedback in scrollback. Skip the checkmark-on-user-message
idea entirely; it conflates bot processing with human reading.

### 2.4 Where the indicator appears

- **Typing indicator:** in the composer area / message-list footer, same
  place human typing shows. Adoo's `message-list.tsx` already has a typing
  footer; ensure bot typing (userId = bot.id, username = bot name) renders
  there with the bot's avatar + "BotName is typing…". The `useTypingStore`
  already keys by userId, so this works for free.
- **Not** on the user's bubble. The bubble is the user's own message —
  putting a "bot saw this" mark there is the wrong abstraction.

---

## 3. Chat Composer UX

### 3.1 Focus management

**Best practice (WhatsApp/Telegram/Discord/Slack):** After sending a
message, focus **stays** in the input. The cursor never leaves the
composer during a chat session unless the user explicitly clicks away.
This is critical for rapid-fire messaging.

Adoo's composer uses an uncontrolled-ish pattern with `textareaRef`. After
`handleSend`, the textarea is not explicitly re-focused, but because the
textarea isn't unmounted, focus is retained naturally. **Verify this holds**
after sending media/voice messages (where focus may shift to a dialog).
Explicitly re-focus after any send path:

```ts
const handleSend = async () => {
  ...
  setText('')
  // Re-focus defensively (covers the post-dialog case)
  requestAnimationFrame(() => textareaRef.current?.focus())
}
```

Also: on channel switch, **auto-focus** the composer so the user can
immediately type. Add `useEffect(() => { textareaRef.current?.focus() }, [channelId])`.

### 3.2 Keyboard shortcuts

Adoo currently has `Enter` to send, `Shift+Enter` for newline
(`message-composer.tsx:70-74`). This is the **most common** convention
(WhatsApp Web, Google Chat, ChatGPT, Slack default). Some apps (Discord,
older Slack) invert this — Enter = newline, Ctrl/Cmd+Enter = send. The
research (UX StackExchange, Discourse meta) shows **Enter-to-send is the
majority convention and the least surprising** for a WhatsApp-style app.

Recommended shortcut set for Adoo:

| Shortcut | Action | Status |
|---|---|---|
| `Enter` | Send | ✓ Have it |
| `Shift+Enter` | Newline | ✓ Have it |
| `Escape` | Cancel reply / close actions menu / blur | **Add** |
| `↑` (ArrowUp) | Edit your last sent message (when input empty) | **Add** (Slack/Google Chat pattern) |
| `Ctrl/Cmd+Enter` | Send (redundant fallback for Discord-refugees) | **Add** |
| `Ctrl/Cmd+K` | (app-level) Quick switcher — out of scope here | — |

Implementation sketch:

```ts
const handleKeyDown = (e: React.KeyboardEvent) => {
  // Enter (no shift) OR Cmd/Ctrl+Enter → send
  if (e.key === 'Enter' && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    handleSend()
    return
  }
  // Escape → cancel reply first, then blur
  if (e.key === 'Escape') {
    if (replyTo) { setReplyTo(null); return }
    e.currentTarget.blur()
    return
  }
  // ArrowUp with empty input → edit last own message
  if (e.key === 'ArrowUp' && text === '' && !e.shiftKey) {
    const lastMine = messages.findLast?.(m => m.senderId === me.id && !m.deletedAt)
    if (lastMine) { startEdit(lastMine); e.preventDefault() }
  }
}
```

### 3.3 Mobile UX

Key patterns that make mobile chat composers good (from WhatsApp/Telegram
native + RN keyboard-controller research):

1. **Sticky input bar** pinned to the bottom of the viewport
   (`position: sticky; bottom: 0` or a flex column with the input as the
   last child). Adoo's layout already does this.
2. **Keyboard-aware layout:** when the soft keyboard opens, the input must
   rise above it and the message list must scroll up so the latest message
   stays visible. On web, this is handled by the **Visual Viewport API**
   (`window.visualViewport`) + `dvh` units. Pure `vh` units break on mobile
   because `vh` doesn't account for the keyboard. Use `100dvh` for the
   container height.
3. **Swipe-to-reply:** long-press or horizontal swipe on a message bubble
   quotes it. WhatsApp/Telegram both do this. On web, implement with a
   pointer-drag gesture (pointer events) that triggers `setReplyTo(msg)`
   past a threshold (e.g. 40px horizontal). This is the single biggest
   "feels native" win for a web chat.
4. **Send button morphs:** when the input is empty, the send button slot
   shows a mic/voice icon; when there's text, it shows the send arrow.
   WhatsApp does this. Adoo already has a voice recorder — wire the icon
   swap.
5. **Avoid `position: fixed` for the input** — it breaks on iOS Safari
   when the keyboard opens. Sticky/flex is safer.
6. **`inputmode="text"` and `autocomplete="off"`** on the textarea to
   avoid iOS autocorrect/autocomplete fighting with the composer.

### 3.4 Desktop UX

- **Resizable input:** a drag handle on the top edge of the composer to
  grow it vertically (Slack/Discord). Adoo caps auto-resize at 160px
  (`message-composer.tsx:47`) — add a manual resize handle for going
  beyond that for long messages. CSS `resize: vertical` with a `max-height`
  is the zero-JS version.
- **Markdown preview:** Discord/Slack show a live preview toggle. For a
  friend group this is optional; lightweight markdown rendering on render
  (bold, italic, code, links) is more valuable than a preview pane.
- **Paste image:** paste from clipboard directly attaches. Add a `paste`
  event handler on the textarea that inspects `clipboardData.items` for
  image types and routes them to the existing upload flow.
- **Drag-drop file attach:** drop a file anywhere on the chat to attach.

### 3.5 Auto-resize textarea

Adoo already does this (`message-composer.tsx:43-48`):

```ts
useEffect(() => {
  const el = textareaRef.current
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
}, [text])
```

This is the classic JS approach and it works. Two improvements to consider:

1. **The new CSS-only way** (Chrome 123+, behind a flag elsewhere):
   `field-sizing: content` makes the textarea grow to fit content with
   zero JS. As of late 2025 it's Chromium-only and gated, so **keep the JS
   approach as the primary** and add `field-sizing: content` as progressive
   enhancement.
2. **Reset on channel switch:** the effect runs on `[text]`, but if the
   user switches channels with a draft (see §3.6), the restored draft
   height isn't recomputed because `text` is set programmatically. Add
   `channelId` to the deps, or call the resize logic in the draft-restore
   effect.

### 3.6 Draft persistence — should unsent drafts be saved?

**Yes.** This is a strong user expectation set by WhatsApp and Telegram:
- WhatsApp stores drafts **locally on device** (SQLite), per-chat, and
  shows a "Draft" label in the chat list. They deliberately do **not**
  sync drafts to the server (privacy).
- Telegram syncs drafts to the **cloud** (per-chat, cross-device), which
  is why "undeletable drafts in groups" is a recurring bug report — a
  restricted member's draft gets stuck server-side.

For Adoo (small friend group, web app, single device per user usually),
**localStorage per channel** is the right call:
- No server round-trip, no privacy concerns, no stuck-draft bugs.
- Survives page refresh and tab close.
- Cleared on successful send.

Implementation:

```ts
const DRAFT_KEY = (channelId: string) => `draft:${channelId}`

// Load draft on channel switch / mount
useEffect(() => {
  const saved = localStorage.getItem(DRAFT_KEY(channelId))
  if (saved) setText(saved)
  else setText('')
  // recompute textarea height after restoring
  requestAnimationFrame(() => {
    const el = textareaRef.current
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }
  })
}, [channelId])

// Debounced save on text change
useEffect(() => {
  const t = setTimeout(() => {
    if (text) localStorage.setItem(DRAFT_KEY(channelId), text)
    else localStorage.removeItem(DRAFT_KEY(channelId))
  }, 300)
  return () => clearTimeout(t)
}, [text, channelId])

// Clear on send
const handleSend = async () => {
  ...
  localStorage.removeItem(DRAFT_KEY(channelId))
  setText('')
}
```

Optional: show a "Draft" badge in the chat list (`chat-list.tsx`) for
channels with non-empty drafts, matching WhatsApp's behavior.

---

## 4. Emoji Picker

### 4.1 What the top apps do

#### WhatsApp (mobile + web)
- **Popover** anchored to the emoji button in the composer.
- **Categories** as icons along the bottom (smileys, animals, food,
  activities, travel, objects, symbols, flags).
- **Search bar** at the top — type "heart" → finds ❤️ 💖 💗 etc.
- **Recently used** row at the top (auto-populated, per-device).
- **Skin tone selector** — long-press a human emoji to pick skin tone
  ( shortcode `+1` → 👍👍🏻👍🏼👍🏽👍🏾👍🏿).
- **No colon-autocomplete** in the text field — you must open the picker.
- Renders emoji using the **system/native** font (Apple on iOS/Mac, Google
  on Android, Segoe on Windows).

#### Slack
- **Popover** anchored to the emoji button.
- **Search** is the primary interaction (Slack users search far more than
  they browse categories).
- **Colon autocomplete inline** — type `:smi` in the text field and a
  dropdown of matching emoji appears. Tab/Enter inserts the emoji and
  removes the `:shortcode`. This is Slack's signature feature and the one
  power-users love most.
- **Custom emoji** (server-specific, uploaded by admins).
- **Recently used** + **frequently used in this workspace** sections.
- Displays emoji as **Twemoji** (consistent cross-platform), not native.

#### Discord
- Similar to Slack: popover + search + colon autocomplete + custom emoji.
- Emoji render as a mix of native + custom images.

### 4.2 Library comparison (2025 research)

| Library | Bundle | Style | Native emoji | Custom emoji | Skin tones | Search | React-friendly |
|---|---|---|---|---|---|---|---|
| **emoji-mart** (missive) | ~150KB+ data | Customizable, framework-agnostic core + React wrapper | Yes (set per set) | Yes (first-class) | Yes | Yes | Yes (`@emoji-mart/react`) |
| **emoji-picker-react** | ~lighter | CSS-variable themable | Yes (Apple/Google/Facebook/Twitter) | No (limited) | Yes | Yes | Yes (React-native) |
| **picmo** | ~medium | Framework-agnostic web component | Yes | Yes | Yes | Yes | Via wrapper |
| **Frimousse** (Liveblocks) | Very light | Unstyled, composable | Yes | Yes | Yes | Bring-your-own | Yes (headless) |
| Native browser picker | 0 KB | OS picker | Yes | No | No | Limited | N/A (trigger via `inputmode`) |

**Known performance issue (Reddit r/reactjs, multiple reports):**
emoji-mart and emoji-picker-react can make the page **sluggish on first
load** because they ship the full emoji dataset (3,700+ emoji with
keywords) in the main bundle. The fix is universal: **lazy-load the picker
+ its data via `React.lazy` / dynamic `import()`**, only fetching when the
user first opens the picker. A `<Suspense>` fallback skeleton avoids the
jank.

### 4.3 Recommendation for Adoo

**Use `emoji-mart`** (`@emoji-mart/react` + `@emoji-mart/data`):
- Best-in-class for custom emoji later (you said skip for now, but the
  architecture allows it without a rewrite).
- Framework-agnostic core means it survives a future framework migration.
- Active maintenance (missive fork is the maintained one; the old
  `emoji-mart` by missive is now `@emoji-mart/*` scoped packages).
- Supports skin tones, search, categories, recent — all the WhatsApp/Slack
  features out of the box.

**Critical: lazy-load it.** Do not import the picker or its data at the
top of `message-composer.tsx`. Wrap it:

```tsx
// src/components/chat/emoji-picker.tsx
'use client'
import { lazy, Suspense } from 'react'
const Picker = lazy(() => import('@emoji-mart/react').then(m => ({ default: m.default })))
const emojiData = lazy(() => import('@emoji-mart/data').then(m => ({ default: m.default })))

export function EmojiPicker({ onPick }: { onPick: (e: { native: string }) => void }) {
  return (
    <Suspense fallback={<div className="w-80 h-72 skeleton" />}>
      <PickerLazy data={...} onEmojiSelect={onPick} theme="light" previewPosition="none" />
    </Suspense>
  )
}
```

In practice, load the data once and pass it in; the picker component
itself is the part to `lazy()`.

### 4.4 Popover vs modal vs inline panel

- **Popover anchored to the emoji button** — the universal winner. Used by
  WhatsApp, Slack, Discord, Telegram Web. Doesn't block the chat, doesn't
  steal focus from the textarea (important: the user keeps typing
  position). Use the existing `Popover` from `src/components/ui/popover.tsx`
  (shadcn/ui) to anchor it to the emoji toggle button.
- **Modal** — too heavy, blocks the chat. Avoid.
- **Inline panel** (replaces the keyboard area, mobile-style) — only
  makes sense on mobile where the soft keyboard and a popover would
  conflict. On mobile web, consider swapping the popover for an
  inline panel that replaces the message list area while open (Telegram
  Web mobile does this). For a first version, the popover is fine on all
  sizes.

### 4.5 Emoji rendering in text

Messages containing emoji should render them correctly with **no special
library** if you rely on the system emoji font. Set the message body's CSS
to a font stack that includes an emoji font last:

```css
.message-body {
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto,
               'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
}
```

This renders emoji natively (Apple on Mac/iOS, Google on Android, Segoe on
Windows). Cross-platform consistency (everyone sees the same glyph) requires
**Twemoji** or **emoji-mart's `emoji-mart/data` + a renderer**, at the
cost of image-loading every emoji. For a friend group, **native rendering
is fine** — friends on different platforms seeing slightly different
emoji art is acceptable and is what WhatsApp does.

### 4.6 Colon autocomplete (Slack-style `:smile`)

**Recommended** — it's the single biggest emoji UX win for desktop users
who can't easily type emoji, and it's the feature desktop chatters
specifically request. Slack, Discord, and GitHub all have it; WhatsApp
does not (WhatsApp's audience is mobile-first).

Implementation (no library needed for the autocomplete logic):

1. On every keystroke in the textarea, check if the cursor is inside a
   `:word` token (regex: `/:([\w+-]{1,32})$/` at the caret position).
2. If yes, show a small floating dropdown above the textarea with matching
   emoji (search `@emoji-mart/data` shortcodes). Limit to ~8 results.
3. `Tab` / `Enter` inserts the selected emoji's native glyph and removes
   the `:shortcode` text. `Escape` closes the dropdown. `ArrowUp/Down`
   navigates.
4. If no match and the user types a closing `:`, optionally auto-replace
   `:shortcode:` with the emoji (Slack does this).

```ts
function getColonQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret)
  const match = before.match(/:([a-z0-9_+-]{1,32})$/i)
  return match ? match[1] : null
}
```

The emoji dataset (`@emoji-mart/data`) includes `shortcodes` for every
emoji, so search is a simple filter. Memoize a flat shortcode→native map
on first load.

### 4.7 Search, recently-used, skin tones

- **Search:** comes free with emoji-mart's built-in search.
- **Recently used:** emoji-mart persists this in `localStorage` under
  a key you configure (`autoExpand` / `dynamicWidth` options). No custom
  code needed.
- **Skin tones:** emoji-mart shows a skin-tone picker on long-press /
  hover for human emoji. Set `skinTonePosition="search"` or
  `skin` prop. The chosen tone persists.

### 4.8 Custom emoji

Out of scope per the brief, but note: emoji-mart's `custom` prop accepts
an array of `{ name, emojis: [{ id, name, keywords, skins: [{ src }] }] }`,
so when you do want server-specific emoji later, the picker is ready —
you'd only need a `CustomEmoji` table and an upload route.

---

## 5. Summary — what to build, in priority order

Grounded in the existing Adoo codebase. Items marked ✅ already exist;
marked 🔧 are the recommended additions.

### Read receipts
1. ✅ Hybrid schema (`MessageReadReceipt` + `lastReadMessageId`) — keep.
2. ✅ `channel:read` socket event + optimistic client patch — keep.
3. ✅ `User.readReceiptsEnabled` privacy toggle + settings UI — keep.
4. ✅ `/api/channels/[id]/read` upsert route — keep.
5. 🔧 **Add `deliveredAt` to `Message`** + `channel:delivered` socket
   event (recipient-acks-receipt). This closes the WhatsApp "double gray"
   gap.
6. 🔧 **Render receipt ticks** in the message bubble footer
   (`message-list.tsx`): ✓ sent, ✓✓ gray delivered, ✓✓ blue read. Use
   lucide's `Check` / `CheckCheck` icons. Skip ticks on `senderType==='bot'`
   messages.
7. 🔧 **Group read state:** show ✓✓ blue only when all members have a
   `MessageReadReceipt`; optionally a "N/M" badge in between.
8. 🔧 **Long-press → "Read by" info sheet:** query
   `MessageReadReceipt` joined to `ChannelMember`.
9. 🔧 Fan `channel:read` out to all channel members via presence map
   (mirror the existing `channel:typing` fan-out) so the chat-list
   "read" indicator updates in real time across channels.

### Bot interception indicator
1. ✅ `setTyping` helper in bot framework (re-emits every 4s) — keep.
2. 🔧 **Fire `setTyping` on message receipt** (before processing), not
   only inside long-running nodes. Even a 1-2s pulse gives the "bot saw
   it" feel.
3. 🔧 Ensure bot typing renders in the message-list typing footer with
   the bot's avatar/name (should work via existing `useTypingStore`,
   verify the render path).
4. 🔧 (Optional) For >3s operations, react to the user's message with ⏳
   then ✅. Persistent ack in scrollback.

### Chat composer
1. ✅ Enter-to-send, Shift+Enter newline — keep.
2. ✅ Auto-resize textarea (capped 160px) — keep; add `channelId` to deps
   for draft restore, add `field-sizing: content` as progressive enhancer.
3. 🔧 **Escape** to cancel reply / blur.
4. 🔧 **ArrowUp** (empty input) to edit last own message.
5. 🔧 **Cmd/Ctrl+Enter** to send (redundant fallback).
6. 🔧 **Draft persistence** via `localStorage` per channel (load on
   switch, debounced save, clear on send). Optional "Draft" badge in
   chat list.
7. 🔧 **Re-focus textarea** after send and on channel switch.
8. 🔧 Use `100dvh` for chat container height (mobile keyboard).
9. 🔧 **Swipe-to-reply** (pointer-drag gesture on message bubbles).
10. 🔧 Paste-image handler; drag-drop file attach.

### Emoji picker
1. 🔧 Install `@emoji-mart/react` + `@emoji-mart/data`.
2. 🔧 **Lazy-load** the picker (`React.lazy` + `Suspense`) to avoid
   first-load jank.
3. 🔧 Mount in a `Popover` anchored to the emoji button in the composer.
4. 🔧 Emoji font stack on `.message-body` for native rendering.
5. 🔧 **Colon autocomplete** (`:smile` → dropdown → Tab to insert).
6. 🔧 Recently-used + skin tones come free from emoji-mart config.

---

## 6. Sources

- WhatsApp Help Center — "How to check read receipts" (faq.whatsapp.com/665923838265756)
- blueticks.co — "WhatsApp Read Receipts Explained" (state-by-state breakdown)
- getkanal.com — "WhatsApp Blue Ticks: Meaning & How to Turn Them Off"
- Telegram bugs/issues — bugs.telegram.org/c/84/25 (group read at scale),
  c/23866, c/463 (drafts)
- community.latenode.com — "Can Telegram bots show online status or
  typing indicator?" (confirms bots only have `sendChatAction("typing")`)
- Discord API docs / discordpy — `ctx.typing()` context manager
- StackOverflow (dba, main) — chat schema patterns (MessageParticipants
  with `read` boolean vs receipts table vs hybrid)
- oneuptime.com — "How to Design a Schema for a Chat Application"
  (read-receipts table pattern)
- Slack Help — "Use emoji and reactions" + "Slack keyboard shortcuts"
  (↑ to edit last message, `:colon:` autocomplete)
- Google Chat shortcuts — support.google.com/chat/answer/7649271
- UX StackExchange — Enter-to-send vs Ctrl+Enter debate
- CSS-Tricks — "The Cleanest Trick for Autogrowing Textareas"
  (field-sizing / content-clone approaches)
- r/reactjs — "Slow Emoji Picker Libraries" (lazy-load fix)
- Liveblocks — Frimousse (unstyled emoji picker for React)
- missive/emoji-mart — GitHub README (features, custom emoji support)
- vibe-studio.ai — "Building A Realtime Chat UI With Typing Indicators
  And Read Receipts" (socket event patterns)
- Adoo codebase: `prisma/schema.prisma`, `src/lib/realtime-server.ts`,
  `src/hooks/useChannel.ts`, `src/app/api/channels/[id]/read/route.ts`,
  `src/lib/bot/framework.ts`, `src/components/chat/message-composer.tsx`,
  `src/components/chat/message-list.tsx`, `agent-ctx/chat-ux-improvements.md`

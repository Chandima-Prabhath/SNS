# Adoo Chat UX Improvements

## Summary

Implemented 7 chat UX improvements on the Adoo chat app at `/home/z/my-project`.
All changes build cleanly (`npx next build` ✓ — "Compiled successfully in 18.6s")
and lint cleanly on the modified files (no new errors / warnings).

## Files Modified

| File | Change |
|---|---|
| `src/app/api/channels/route.ts` | Add `lastMessage` + `lastMessageAt` to each channel response |
| `src/lib/realtime-server.ts` | Fan `channel:typing` out to all channel members (not just room viewers) |
| `src/components/chat/chat-list.tsx` | Sort by lastMessageAt, show preview/timestamp, typing indicator |
| `src/components/chat/message-list.tsx` | Scroll-to-bottom button with unread badge |
| `src/components/layout/app-shell.tsx` | Mount `useGlobalTyping` hook |
| **NEW** `src/stores/useTypingStore.ts` | Zustand store for per-channel typing state |
| **NEW** `src/hooks/useGlobalTyping.ts` | Global typing event listener + stale-entry sweep |

---

## P0 — Chat list sorted by most recent message

**`src/app/api/channels/route.ts`:** For each text channel, fetch the latest
non-deleted message via `findFirst({ orderBy: { createdAt: 'desc' } })`. Run
all per-channel queries in parallel via `Promise.all` so total latency is one
round-trip. The Message table has `@@index([channelId, createdAt])` so each
query is an indexed lookup — fast even for channels with long histories.

Attach `lastMessage: { body, mediaUrl, mediaType, senderName, senderType,
senderId, createdAt }` and `lastMessageAt` (ISO string) to each channel.
Empty channels fall back to `channel.createdAt` so they sort predictably
without disappearing from the list.

**`src/components/chat/chat-list.tsx`:** After building `allChats`, sort by
`channel.lastMessageAt` descending. Voice/video channels (which have no
`lastMessageAt`) fall back to their `createdAt` and naturally sort below
active text channels.

## P0 — Message preview + timestamp in chat list

**`src/components/chat/chat-list.tsx`:** Replaced the old secondary line
(`@username` for DMs, group name for groups) with:

- **Top row:** display name (left) + timestamp (right)
  - Today → `HH:mm` (e.g. "14:23")
  - Yesterday → "Yesterday"
  - This year → `MMM d` (e.g. "Mar 5")
  - Older → `MMM d, yyyy`
  - Comparison is by calendar date (via date-fns `isToday`/`isYesterday`),
    NOT raw epoch millis — so a message sent at 23:59 and viewed at 00:01
    correctly shows "Yesterday".
- **Bottom row:** preview text (left) + unread badge (right)
  - Media messages: "Photo", "Video", "Voice message", "File" — optionally
    with caption ("Photo: check this out")
  - Group channels: prefix with sender name ("Sarah: lol that was wild"),
    "You: ..." for own messages
  - DM with bot: prefix bot name on bot replies
  - DM with user: just the message body (partner name is already in title)
  - Truncated to ~40 chars

Extracted the row into a `ChatTextRow` component so each row can subscribe
to its own typing state via `useTypingStore` without re-rendering every row
on every typing pulse.

## P0 — Unread badge verification

Verified the existing unread badge code is correct:

- `src/components/chat/chat-list.tsx` renders the badge with
  `unreadCount > 0 && !active` (hidden when the channel is open).
- `src/hooks/useNotifications.tsx` invalidates `['unread-counts']` and
  `['channels']` on every `notify` event (line 49-50), so the badge updates
  in real-time when a new message arrives in any channel.
- `src/hooks/useUnreadCounts.ts` refetches every 10s as a fallback.
- `src/hooks/useChannel.ts` calls `markRead` on every new message in the
  active channel, which clears the badge immediately.

No changes needed — the existing implementation works correctly.

## P1 — Scroll-to-bottom button

**`src/components/chat/message-list.tsx`:** Added a floating circular button
at the bottom-right of the message list:

- **Visibility:** appears when the user has scrolled >200px from the bottom
  (per task spec). Hides when at the bottom.
- **Icon:** `ChevronDown` from lucide-react.
- **Unread badge:** shows the count of new messages that arrived BELOW the
  current scroll position. Resets to 0 when:
  - The user scrolls back to the bottom, OR
  - The user clicks the button (which smooth-scrolls to bottom)
- **Animation:** Framer Motion fade/scale in/out.
- **Accessibility:** `aria-label="Scroll to latest messages"`, `title` tooltip.

The unread-below counter handles bursts (e.g., multiple bot replies landing
in a single render) by comparing the index of the last-seen message ID
against the current messages array length.

Channel-switch state reset uses the React-endorsed "derived state" pattern
(calling `setState` during render in a conditional) instead of
`useEffect+setState`, avoiding the `react-hooks/set-state-in-effect` lint
warning and the extra render cycle.

## P1 — Typing indicator in chat list

**Problem:** The existing `useChannel` hook only listens for typing events
on the currently-active channel (it filters by `t.channelId !== channelId`).
For the chat list we need to know when ANY of the user's channels has active
typers. But the server's `channel:typing` handler only broadcast to sockets
in the channel room — and the client only joins the active channel room.

**Server fix (`src/lib/realtime-server.ts`):** Modified the `channel:typing`
handler to ALSO fan out to all channel members via the in-memory presence
map. For each channel member (excluding the typist themselves), look up
their socket IDs in `presence` and emit `channel:typing` directly to each
socket. Uses `volatile` so a slow connection doesn't queue up stale typing
pulses. Skips sockets already in the channel room (they got it via the
existing room broadcast) to avoid double-delivery.

The DB lookup (`db.channelMember.findMany`) on each typing pulse is
acceptable because typing is debounced client-side to ~1.5s — at most ~0.7
QPS per typist, which SQLite handles easily.

**Client store (`src/stores/useTypingStore.ts`):** A Zustand store with
`typingByChannel: Record<channelId, Record<userId, { username, lastUpdate }>>`
and `setTyping` / `clearTyping` / `clearChannel` actions. Storing
`lastUpdate` per typer lets a periodic sweep evict stale entries (see below).

**Client hook (`src/hooks/useGlobalTyping.ts`):** Mounted once at the app
root (in `app-shell.tsx`, alongside `useNotifications`). Listens for
`channel:typing` events globally (no channelId filter) and updates the store.
Runs a 1s interval sweep that clears any typing entries older than 5s —
this handles the case where a typist's `isTyping:false` event was lost
(e.g., they closed the tab mid-type). Also clears all typing state when
the socket disconnects.

**Chat list integration (`src/components/chat/chat-list.tsx`):** Each
`ChatTextRow` subscribes to `useTypingStore` with a selector that returns
a primitive boolean (so the row only re-renders when ITS channel's typing
state changes). When typing is active AND the channel is NOT currently
open, the preview text is replaced with italic "typing..." + animated
dots. The active channel's typing indicator is handled by the existing
in-chat typing indicator at the bottom of `message-list.tsx`.

## P1 — Day divider verification

Verified the existing day divider logic in
`src/components/chat/message-list.tsx` is correct:

```ts
function formatDay(dateStr: string | Date) {
  const d = new Date(dateStr)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMM d, yyyy')
}

// In render:
const dayLabel = formatDay(first.createdAt)
const prevGroup = gi > 0 ? grouped[gi - 1] : null
const showDayDivider = !prevGroup || formatDay(prevGroup[0].createdAt) !== dayLabel
```

- `isToday` / `isYesterday` from date-fns compare calendar dates (local
  timezone), NOT raw timestamps.
- The comparison is between formatted day labels (strings), so two messages
  on the same calendar day produce the same label and don't show a divider.
- The first message always shows a divider (for context).

No changes needed — the existing implementation works correctly.

## Build verification

```
✓ Compiled successfully in 18.6s
✓ Generating static pages using 1 worker (33/33) in 147.0ms
```

`npx eslint` on all 7 modified/new files passes with no errors or warnings.
(Pre-existing lint errors in `global-music-player.tsx`, `status-view.tsx`,
`circular-gallery.tsx`, `bot-builder-editor.tsx`, and `rnnoise.worklet.js`
are unrelated and unchanged.)

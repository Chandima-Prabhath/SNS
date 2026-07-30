# Adoo App — TTS / Avatar / Voice Message Improvements

## Summary

Implemented 4 tasks on the Adoo chat app at `/home/z/my-project`. All changes
build cleanly (`npx next build` ✓ — "Compiled successfully in 19.1s").

## Task 1 — Fix TTS slow generation (`src/app/api/tts/route.ts`)

**Problem:** The route buffered the entire TTS response with
`await ttsRes.arrayBuffer()` before writing to disk and returning the URL.
This meant the client waited for the full audio + disk write before seeing
anything.

**Fix:**
- Stream the TTS server response straight through to the client using
  `ttsRes.body.tee()` — one branch goes to the client (low TTFB, playback
  can start immediately), the other is piped to a file write stream in the
  background via a new `streamToFile()` helper.
- The saved-file URL is returned in the `X-Tts-Url` response header so the
  client can send the message with that URL without waiting for the disk
  write to finish.
- Cached the `uploadDir` existence check (`uploadDirEnsured`) so we don't
  `stat()` on every request.
- Verified built-in voices use `voice_url` (fast, pre-built) and `voice_wav`
  is only used for custom voices without a safetensors model (the slow
  voice-cloning path — necessary, not accidental).
- No file reads / ffmpeg before the TTS call for built-in voices.

**Client change (`message-composer.tsx` TtsDialog.handleGenerate):** reads the
streamed audio into a blob for instant preview and pulls the URL from the
`X-Tts-Url` header for sending.

## Task 2 — Fix TTS voice list labels

**Route GET handler:** the labels were already correct (alba=Female,
charles=Male, etc.) — verified against the task's canonical list.

**Composer:** the `Select` had a hardcoded, incomplete list (10 of 15 voices).
Replaced both hardcoded `<SelectItem>` blocks with a dynamic list fetched from
`GET /api/tts` (`useQuery(['tts-builtin-voices'])`). The API is now the single
source of truth, so labels and the available voices can never drift apart.
Labels are formatted as `Name (Language, Gender)`.

## Task 3 — Improve avatar picker (`src/lib/avatar.ts`)

Expanded from 3 styles to **14 DiceBear 9.x styles**: adventurer, avataaars,
big-ears, big-smile, bottts, fun-emoji, lorelei, micah, miniavs, notionists,
open-peeps, personas, pixel-art, shapes.

`generateAvatarCandidates()` now produces **56 candidates** (14 styles × 4 seed
variations). Each candidate carries a `label` for grouping.

**Settings view (`settings-view.tsx` AvatarPicker):** the gallery is now grouped
by style with a label header, rendered in a scrollable container
(`max-h-96 overflow-y-auto`) with 8 columns on desktop so the long list stays
browsable. Added `AVATAR_STYLES` to the imports.

## Task 4 — Voice message recording + `/api/upload`

**`useVoiceRecorder` hook (`message-composer.tsx`):**
- Added a mic button **inside the composer pill, next to the TTS button**.
- Tap to start recording (MediaRecorder API, picks the best supported codec:
  webm/opus → webm → ogg/opus → mp4).
- While recording: the composer pill is replaced by a recording bar with a
  pulsing red dot, a live `m:ss` timer, a Cancel button (trash icon), and a
  Stop+Send button (send icon).
- Stop+Send uploads the blob via `/api/upload` and sends it as a message with
  `mediaType: 'audio/webm'` (or the browser's chosen format). The message-list
  audio player renders it.
- Cancel discards the recording and releases the mic.
- Mic tracks + timer are cleaned up on unmount.

**`src/app/api/upload/route.ts` (NEW):** the app was already calling
`/api/upload` (image uploads, status media, TTS voice clips) but the route
didn't exist. Created it: auth-required, accepts multipart `file`, saves to
`public/uploads/`, returns `{ url, type, size, name }`, 25MB cap.

## Build verification

```
✓ Compiled successfully in 19.1s
✓ Generating static pages using 1 worker (31/31)
```

`bun run lint` on the modified files passes with no errors. (Pre-existing lint
errors in `global-music-player.tsx`, `status-view.tsx`, `circular-gallery.tsx`
are unrelated and unchanged.)

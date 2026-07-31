# Helper Node Patterns in Visual Bot Builders — Research Report

Research goal: find "helper node" patterns across n8n, Voiceflow, Botpress, ManyChat/Chatfuel, and the Telegram Bot API, then decide which ones to add to our Node.js + ReactFlow bot builder.

This report is grounded in **our current node catalog** (from `src/lib/bot/flow-types.ts`), so every recommendation says either *"you already have this"* or *"add this"* with concrete implementation notes.

---

## 0. What we already have (baseline)

Our `NodeType` union already covers a lot. Mapped to the patterns below:

| Category | Node | Notes |
|---|---|---|
| trigger | `trigger` | subtypes: `any_message`, `command`, `mention` |
| output | `message`, `send_media`, `typing`, `tts` | typing is a "pause" node |
| input | `input`, `wait_choice` | pause/resume via `ConversationSession` |
| logic | `condition`, `switch_case`, `set_var`, `counter`, `format_string`, `delay`, `log`, `stop` | switch has multi-output + `default` |
| advanced | `api_call`, `random`, `ai_generate`, `asr_transcribe` | |

Context variables already auto-populated by `visual.ts` / `interpolate()`:
`{{sender}}`, `{{body}}`, `{{args}}`, `{{mediaUrl}}`, `{{mediaType}}`, `{{transcript}}`, plus any user `{{var}}`.

**Key takeaway:** message-type detection is *already possible today* via `Condition` on `{{mediaType}}` or `Switch` on `{{mediaType}}`. The real question is UX: should we add a dedicated, friendlier node for it? (Answer: yes — see §A.)

---

## 1. Per-platform findings

### 1.1 n8n — the gold standard for branching nodes
*(docs.n8n.io — IF, Switch, Merge nodes)*

| Node | How it works | Relevant to us? |
|---|---|---|
| **IF** | Two outputs (`true`/`false`). One comparison: `value1 <op> value2`. Operators include `equals`, `contains`, `starts with`, `exists`, regex, etc. | ✅ We have this as `condition`. |
| **Switch** | **Multiple outputs**, one per "routing rule" + a fallback. Each rule has a data-type dropdown (String / Number / DateTime / Boolean) and a comparison op. Newer "Dynamic Switch" supports up to 50 outputs. Option "Send data to all matching outputs" = fan-out. | ✅ We have `switch_case`. Ours is string-equality only (cases[]). n8n's per-rule operator + type is more powerful. |
| **Filter** | Passes/filters *items* (n8n is batch-oriented). Not a branch — it removes data. | ❌ We're single-item per message; not needed. |
| **Merge** | Combines 2+ branches back into one stream. Modes: append, combine by index, combine by key, wait-for-all. | ⚠️ n8n's Merge is a common pain point (community threads about it triggering both IF branches). See §B on "Merge". |
| **Set / Edit Fields** | Create/overwrite variables. | ✅ We have `set_var`. |
| **Loop / Split In Batches** | Iterates over arrays. | 🟡 See §B "Loop". |

**Branching on data type in n8n:** they don't have a "message type" node (it's a generic automation tool). Users branch on type via a Switch with rules like `{{ $json.type }}` `equals` `voice`. Exactly the pattern we can offer — but specialized.

### 1.2 Voiceflow — the chatbot-native reference
*(docs.voiceflow.com — Steps: Speak, Choice, Condition, Intent, Set, API, Logic)*

- **Condition step**: multi-branch (not just true/false) — each branch is a `if/else if/else` rule. Checks variable values. This is closer to our `switch_case` than our `condition`.
- **Choice step**: presents buttons/options; on user reply, matches to an **Intent** or button value and routes. Equivalent to our `wait_choice`.
- **Intent step**: NLU classification — takes free text, matches to a trained intent, routes per intent. (We have no NLU; closest is `ai_generate` + `switch_case`.)
- **How Voiceflow detects text vs audio vs image:** it largely *doesn't expose this as a first-class routing node*. Voiceflow is channel-agnostic and leans on its NLU/Choice model. Media-type branching is done via a **Condition** on a variable like `{{request.type}}` or via custom code. For voice specifically, Voiceflow relies on the channel (Alexa/Google) sending an intent, not on inspecting "is this audio."

**Lesson:** chatbot-native platforms often *hide* media-type routing behind NLU. For a Telegram/media-heavy app like ours, explicit media-type routing is actually more useful than Voiceflow's approach.

### 1.3 Botpress — expression-based transitions
*(botpress.com/docs — Nodes, Cards, Transitions)*

- A **Node** holds an ordered list of **Cards**: `Say` (text), `Text`, `Question` (single/multiple choice), `Image`, `Audio`, `Video`, `Card` (carousel), `Capture` (save user reply to var), `Execute Code` (JS), `Transition`, `AI Task`.
- **Transitions** are the edges between nodes. Each transition has an **expression** (JS expression evaluated at runtime), e.g. `event.payload.type === 'audio'` or `user.isAdmin`. There's always a fallback transition (like our `default`).
- **Message-type routing:** done via a Transition with an expression like `event.nlu.intent === '...'` *or* raw payload checks `event.payload.type === 'voice'`. Botpress exposes the full raw event payload to expressions — very flexible but requires JS literacy.
- **Autonomous Node**: an LLM decides which card/tool to run (agentic). Interesting but out of scope for a friend-group app.

**Lesson:** Botpress's "transition = JS expression" is the most powerful model but the least beginner-friendly. Our `condition`/`switch_case` with `{{var}}` placeholders is a good middle ground. We could add one "JS expression" escape-hatch node for power users (see §B).

### 1.4 ManyChat / Chatfuel — no-code, Telegram-aware
*(help.manychat.com, chatfuel.com)*

- **Condition block**: branches on system fields ("Last interaction", "Subscriber has tag", "User Input matches") or custom fields. Telegram-specific conditions exist (e.g., "Last interaction in Telegram").
- **User Input block**: asks a question, saves reply to a field, supports "expected answer type" (text/number/phone/email) with re-prompt on mismatch.
- **Has-media / is-voice branching:** ManyChat exposes attachment type via conditions like *"User Input is Voice"* / *"is Image"* in some channel packs, but it's inconsistent. Chatfuel leans on "User Input" + plugin checks.
- These platforms are FB-Messenger-first; their Telegram support is weaker and media routing is often a plugin/custom JSON block.

**Lesson:** no-code platforms confirm that a dedicated, *labeled* "Is this a voice message?" condition is what non-technical users want — not "Switch on `{{mediaType}}`."

### 1.5 Telegram Bot API — the message field reference
*(core.telegram.org/bots/api — Message object)*

A Telegram `Message` has **mutually-exclusive** content fields. Only one of these is set per message:

| Field | Type | Our `mediaType` value |
|---|---|---|
| `text` | String | `(empty)` — we treat text as no media |
| `voice` | Voice (ogg opus) | `audio` (our ASR target) |
| `audio` | Audio (mp3/m4a, music) | `audio` |
| `photo` | array of sizes | `image` |
| `video` | Video | `video` |
| `video_note` | Round video | `video` (or `video_note`) |
| `document` | Generic file | `file` / `document` |
| `sticker` | Sticker | `sticker` |
| `animation` | GIF/mp4 | `video` |
| `contact` | Contact | — |
| `location` | Location | — |
| `poll` | Poll | — |
| `dice` | Dice | — |
| `caption` | String | attached to photo/video/document |
| `forward_origin` | object | marks forwarded messages |
| `message_thread_id` | int | topic in a forum group |

Chat context fields (always present):
- `chat.type`: `"private" | "group" | "supergroup" | "channel"`
- `chat.id`: negative = group
- `from.id`, `from.is_bot`
- `message_id`, `date`
- `reply_to_message`: present if it's a reply (quote)

**Routing patterns commonly used:**
1. `if (msg.text)` → text path
2. `if (msg.voice)` → ASR path
3. `if (msg.photo)` → image path
4. `if (msg.document)` → file path
5. `caption` is the *text* for any media message → extract for caption-based commands.

Our `mediaType` today collapses `voice`+`audio`→`audio` and lumps stickers/animations. That's fine for v1, but we should expose a finer-grained `{{messageType}}` (see §A recommendation).

---

## A. Message-type detection patterns

### The three approaches found across platforms

| Approach | Who uses it | How it looks | Verdict for us |
|---|---|---|---|
| **Dedicated "Message Type" node** (one output per type) | ManyChat-style "is voice?" blocks; Botpress transition-per-type | A node with handles: `text · voice · image · video · file · sticker · other` | ✅ **Best UX. Add this.** |
| **Regular Condition on `{{mediaType}}`** | Our current hint in the ASR node | `Condition: mediaType contains audio` | 🟡 Already works; keep as the "manual" option. |
| **Generic Switch with cases** | n8n Switch; Botpress expressions | `Switch` on `{{mediaType}}`, cases = `image,video,audio` | ✅ Already have `switch_case`. Good fallback. |

### Recommendation: add a `message_type` helper node

**Pattern name:** Message Type Router (dedicated multi-output node)
**Used by:** conceptual blend of ManyChat's labeled conditions + n8n's multi-output Switch.
**How it works:**
- One input, fixed outputs: `text`, `voice`, `image`, `video`, `file`, `sticker`, `other` (+ optional `default`).
- Engine inspects `ctx.message` / `__mediaType` and routes to the matching handle.
- No configuration needed — it's a zero-config "smart" node.

**Why worth it:** It's the #1 thing a friend-group bot author wants ("if someone sends a voice note, transcribe it; if a photo, caption it"). Today they must know that `{{mediaType}}` exists and string a Condition. A labeled node makes it one drag.

**Implementation sketch** (fits existing architecture):
```ts
// flow-types.ts
| 'message_type'   // new NodeType, category: 'logic'

// FlowNodeData additions
messageTypeCases?: { text: boolean; voice: boolean; image: boolean;
                     video: boolean; file: boolean; sticker: boolean }
// sourceHandle convention: 'text' | 'voice' | 'image' | 'video' | 'file' | 'sticker' | 'other'

// engine: pick handle from a normalized type map
const TYPE_HANDLE: Record<string,string> = {
  '': 'text', text: 'text',
  audio: 'voice',        // our current mediaType uses 'audio' for voice
  image: 'image', video: 'video', file: 'file', sticker: 'sticker'
}
const handle = TYPE_HANDLE[ctx.variables.__mediaType ?? ''] ?? 'other'
```
Also expose a finer `{{messageType}}` variable = `text|voice|image|video|file|sticker|other` (distinct from `{{mediaType}}` which stays as the raw-ish value for backward compat).

**Effort:** ~1 hr (catalog entry + engine branch + editor handles + a normalized type map in `visual.ts`).

---

## B. Common helper nodes — catalog & verdicts

For each: pattern name · who uses it · how it works · **worth it?**

### B1. "Has media?" check
- **Who:** Botpress (expression `!!event.payload.media`), n8n (`exists` op).
- **How:** Boolean condition: does the message have any non-text payload?
- **Worth it:** 🟡 **Low priority.** Already doable as `Condition: {{mediaType}} exists`. But a one-click "Has media?" toggle inside the `message_type` node (route `other`+`text` vs the rest) covers 95% of need. Skip a separate node.

### B2. "Is from bot admin?" check
- **Who:** Botpress (`user.isAdmin` / role checks), ManyChat ("Subscriber has tag Admin").
- **How:** Compare `{{senderId}}` against a configured admin-list, or check a role flag.
- **Worth it:** ✅ **Add as a `condition` preset, not a new node.** Implement: in the Condition editor, add a dropdown "Preset → Is admin / Is private chat / Is group" that fills in the right variable+operator. A friend-group app *will* want "/ban only works if sender is admin." Effort: small — wire `ctx.senderId` against a per-bot `adminUserIds` list on the Bot record.

### B3. "Is private chat vs group?" check
- **Who:** Botpress (`event.channel` / `chat.type`), ManyChat conditions.
- **How:** Branch on `chat.type === 'private'` vs `group/supergroup`.
- **Worth it:** ✅ **Add `{{chatType}}` variable + a Condition preset.** Very common: "only respond to /secret in DMs," "in groups, only reply to mentions." Effort: populate `variables.__chatType` in `visual.ts` from the message's chat type. No new node — reuse `condition`.

### B4. "Extract entity" (regex / JSON path / substring)
- **Who:** n8n (Item Lists + `Code`), Botpress (`Execute Code` + `Capture`), Voiceflow (Set step with functions).
- **How:** Pull a substring, parse JSON, run a regex with capture groups into variables.
- **Worth it:** ✅ **Add a small `extract` node** with three modes:
  - **Regex**: `pattern`, output capture groups → `{{var}}` / `{{var_1}}`.
  - **JSON path**: dot path into a JSON variable (great after `api_call`).
  - **Substring**: between markers.
  Effort: medium. High value — currently users must write a whole `api_call` or `ai_generate` just to slice a string.

### B5. "Set variable" — ✅ have it (`set_var`).

### B6. "Get variable" — 🟡 **Don't add a node.** "Get" is just `{{var}}` interpolation, which we already support everywhere. A dedicated "Get" node would be cargo-culted from block-based platforms (Make/Scratch). Skip.

### B7. "Delay" — ✅ have it (`delay`).

### B8. "Parallel branches / Merge"
- **Who:** n8n (Merge node — and its notorious footguns), Node-RED (Split/Join).
- **How:** Fan out to N branches, then a Merge node waits for all (or first) and continues.
- **Worth it:** ❌ **Skip for now.** Our engine is single-threaded, synchronous-walk, with pause/resume. True parallelism + merge adds huge complexity (state coordination, ordering) for little gain in a friend-group bot. The common real need — "do A, then B" — is just sequential edges. If you ever need "race two API calls," handle it inside a single `api_call`-like node that does `Promise.all` internally. Don't expose parallelism in the graph.

### B9. "Loop"
- **Who:** n8n (Split In Batches / Loop node), Botpress (loops via transitions back to same node).
- **How:** Iterate over an array variable, repeating a sub-graph per item.
- **Worth it:** 🟡 **Defer.** Loops in a visual graph need a bounded iterator + `MAX_STEPS` awareness (we cap at 50). A common, simpler substitute we already support: `counter` + an edge back upstream = a bounded loop. Document that pattern instead of adding a dedicated node. Add a real `loop` node only if users actually ask.

### B10. "HTTP request" — ✅ have it (`api_call`).

### B11. "Send typing indicator" — ✅ have it (`typing` node + `ctx.setTyping`).

### B12. "Mark message as read"
- **Who:** Telegram `sendChatAction`/read receipts; Messenger `markSeen`.
- **How:** Fire-and-forget call to mark the incoming message read.
- **Worth it:** 🟡 **Low priority, but cheap.** Useful so the sender's checkmark turns blue. Implement as a boolean on the `trigger` node ("auto-mark-read") rather than a separate node. Effort: tiny if your chat layer supports it.

### B13. "Forward message"
- **Who:** Telegram `forwardMessage`; Botpress has no first-class node.
- **How:** Forward the incoming message (with original sender attribution) to another chat.
- **Worth it:** 🟡 **Niche.** Only add if a real use case appears (e.g., "forward all media to a log channel"). Could be a checkbox on `send_media` ("forward original instead of re-send"). Defer.

### B14. "Delete message"
- **Who:** Telegram `deleteMessage`; rarely a node in builders.
- **How:** Delete a message by id (bot's own, or in groups with rights).
- **Worth it:** 🟡 **Niche.** Useful for "delete the command message after handling" (clean group chat). Add as a tiny action node later. Defer.

### B15. "Pin message"
- **Who:** Telegram `pinChatMessage`; not a builder node anywhere.
- **Worth it:** ❌ **Skip.** Admin-only, group-only, rarely needed in a friend-group app.

### B16. Bonus: "Run sub-flow" / "Goto node"
- **Who:** n8n (Execute Workflow), Botpress (route to workflow).
- **How:** Call another saved bot flow as a subroutine; reuse flows.
- **Worth it:** 🟡 **Medium priority, high leverage.** Once bots grow, users want to reuse "/remind" logic inside other flows. Implement as a `call_flow` node that runs another flow inline (sharing variables) and returns. Defer to after the helper nodes above, but keep it on the roadmap.

### B17. Bonus: "Expression / Code" escape hatch
- **Who:** Botpress `Execute Code`, n8n `Code` node.
- **How:** A sandboxed JS expression for power users.
- **Worth it:** ✅ **Add a tiny `expr` node** (single JS expression → boolean or string output). This is the safety valve that prevents every missing feature from becoming a blocker. Sandboxed via `Function` constructor with a timeout. Medium effort, high payoff.

---

## C. Long-running operations (5–30s: ASR, LLM, TTS)

This is the most important UX section. Patterns observed:

### C1. Show the user something is happening
- **Telegram**: `sendChatAction('typing')` — but it **expires after ~5 seconds** and must be re-sent. ManyChat/Botpress auto-loop a typing action during async work.
- **Voiceflow**: shows a "processing" visual on web channels; on voice channels, plays silence/hold music.
- **n8n**: no chat surface, but shows execution spinner in the UI.

**Recommendation:** Make every long-running node (`ai_generate`, `asr_transcribe`, `tts`, `api_call` when slow) **auto-emit a typing indicator** before it starts, and **re-emit every 4s** until it finishes. We already have `ctx.setTyping`. Add a small wrapper:
```ts
async function withTyping<T>(ctx, ms, fn: () => Promise<T>): Promise<T> {
  await ctx.setTyping?.(ms)
  const tick = setInterval(() => ctx.setTyping?.(ms).catch(()=>{}), 4000)
  try { return await fn() } finally { clearInterval(tick) }
}
```
Wire all four slow nodes through it. Effort: ~30 min.

### C2. Send typing indicators — ✅ covered by C1.

### C3. Handle timeouts
- **n8n**: per-node `retryOnFail` + global execution timeout.
- **Botpress**: action timeout + a fallback transition ("on error").
- **Azure Bot Framework** (long-running ops guidance): *proactive messaging* — return immediately from the turn, do work in background, send the reply as a separate proactive message later.

**Recommendation:**
- Add a **per-node `timeoutMs`** (default: ASR 60s, LLM 120s, TTS 30s, API 30s). On timeout, set the output variable to `""` and emit a trace `error` event, then continue to a dedicated `error`/`timeout` output handle if one exists (else follow the normal edge). This mirrors Botpress's fallback-transition idea.
- For ASR specifically: if transcription fails/empty, the node already falls back gracefully (per the existing node docs). Keep that; just add the timeout.
- Our `MAX_STEPS = 50` cap already protects against infinite loops; add a **wall-clock budget** too (e.g., abort a flow if cumulative node time > 180s).

### C4. Allow cancellation
- **Botpress/n8n**: users can stop a running execution from the UI; for end-users there's no mid-flow cancel.
- **Telegram**: the user can't cancel a bot's processing except by sending another message.

**Recommendation:** Lightweight — if the user sends a new message *while a flow is mid-ASR/LLM for their previous message*, **treat the new message as a new trigger** rather than queuing behind the slow node. This is effectively "cancel by interruption." For a friend-group app this is the right trade-off; explicit cancel buttons are overkill. Document the behavior.

### C5. Progressive feedback (optional nice-to-have)
- Send an interim message like "🎧 Transcribing your voice note…" *before* the slow node, then **edit** that message with the result when done. We already have `ctx.editMessage`. Pattern: `message("Transcribing…")` → `asr_transcribe` → `editMessage(msgId, transcript)`. Worth documenting as a recipe, not a node.

---

## D. Variable management

How platforms expose variables, and what we should adopt:

### D1. "Variables" panel showing all variables + current values
- **n8n**: shows the input/output JSON of each node during a run (per-node inspector).
- **Voiceflow**: a Variables panel listing all variables + last-known values per test session.
- **Botpress**: variables panel in the emulator, scoped per user/conversation.
- **ManyChat**: "User Fields" + "Bot Fields" admin panels with live values per subscriber.

**Our status:** We show variables in the **test-run result panel** (line ~1311 in the editor) and list available variables in a help panel. We do **not** have a live per-conversation variable inspector for a *running* session.

**Recommendation:** ✅ **Add a small "Variables" inspector** to the bot-builder that, for a given `ConversationSession` in debug mode, shows `currentNodeId` + the persisted `variables`. We already persist these — just render them. Effort: small. High debug value.

### D2. Autocomplete on `{{`
- **n8n**: full autocomplete/variable picker ("Expression editor") with drag-in fields.
- **Voiceflow**: autocomplete dropdown on `{`.
- **Botpress**: autocomplete in expression editor.
- **ManyChat/Chatfuel**: dropdown picker of fields.

**Our status:** Plain text input, no autocomplete. Users must remember variable names.

**Recommendation:** ✅ **Add `{{` autocomplete.** Scan the flow for all `variableName`/`variable` fields used in `set_var`/`input`/`api_call`/etc., plus the built-ins (`sender`, `body`, `args`, `mediaUrl`, `mediaType`, `messageType`, `transcript`, `chatType`), and show a dropdown on `{{`. Effort: medium (need a lightweight mention/combobox in the textarea). Big UX win. Defer if low on time; the help panel listing variables is an acceptable stopgap.

### D3. Variable type checking (string vs number vs object)
- **n8n**: typed (String/Number/DateTime/Boolean) per routing rule.
- **Voiceflow**: loosely typed.
- **Botpress**: JS-typed at runtime.
- **ManyChat**: typed fields (text/number/bool/datetime) with input validation.

**Our status:** All variables are `Record<string, string>`. Numbers are stored as strings; `counter` parses them implicitly.

**Recommendation:** 🟡 **Keep strings; add light coercion, not full types.** A friend-group app doesn't need a type system. Just: in `counter`/`condition` with numeric operators, coerce with `Number()` and NaN-guard. Document that `api_call` responses are stored as JSON *strings* and the `extract` node (B4) parses them. Full type checking = enterprise; skip.

### D4. Scoped variables (per-conversation vs per-user vs global)
- **n8n**: workflow-static-data (global), plus execution data (per-run).
- **Voiceflow**: per-conversation variables + global "variables" (project-level).
- **Botpress**: `user.*` (per-user, cross-conversation), `session.*` (per-conversation), `temp.*` (per-turn), `bot.*` (global).
- **ManyChat**: "User Fields" (per-subscriber) vs "Bot Fields" (global).

**Our status:** Variables are scoped **per-conversation session** (persisted in `ConversationSession`).

**Recommendation:** 🟡 **Add two cheap scopes later, not now:**
- **Per-user** (`user.*`): survives across conversations/channels with the same user — useful for "remember my name." Implement by keying off `senderId` in a `UserBotState` table.
- **Global** (`bot.*`): shared across all users of a bot — useful for a daily counter or "bot mood." Implement as a single row per Bot.
Use a naming prefix convention (`user.foo`, `bot.foo`, everything else = session) rather than a UI selector — matches Botpress and is zero-config. Defer until a real need appears; per-conversation covers ~90% of friend-group use cases.

---

## E. Prioritized implementation roadmap

Tiered by effort × value for a small friend-group chat app:

### Tier 1 — Do now (high value, low effort)
1. **`message_type` node** (§A) — dedicated media-type router. ~1 hr.
2. **Auto-typing wrapper** for slow nodes (§C1). ~30 min.
3. **Expose `{{chatType}}`** + **Condition presets** for "is admin" / "is private" / "is group" (§B2, §B3). ~1 hr.
4. **Per-node `timeoutMs`** + timeout/error output handle (§C3). ~1.5 hr.
5. **Auto-mark-read** toggle on the trigger node (§B12). ~20 min.

### Tier 2 — Do soon (medium value, medium effort)
6. **`extract` node** (regex / JSON path / substring) (§B4). ~3 hr.
7. **`expr` node** — sandboxed JS expression escape hatch (§B17). ~2 hr.
8. **Variables inspector** for live sessions (§D1). ~2 hr.
9. **`{{` autocomplete** in text fields (§D2). ~3 hr.

### Tier 3 — Defer until asked (nice to have)
10. `call_flow` / sub-flow node (§B16).
11. `delete_message` / `forward_message` as small action nodes (§B13, §B14).
12. Per-user (`user.*`) and global (`bot.*`) variable scopes (§D4).
13. Bounded `loop` node (§B9) — document counter+back-edge pattern first.

### Skip (enterprise / not worth it)
- Parallel branches / Merge node (§B8).
- Pin message node (§B15).
- Dedicated "Get variable" node (§B6).
- Full variable type system (§D3).
- Filter node (n8n-only concept, §1.1).

---

## F. Summary table — pattern → platform → verdict

| Pattern | n8n | Voiceflow | Botpress | ManyChat | Verdict |
|---|---|---|---|---|---|
| IF / Condition | IF node | Condition step | expression transition | Condition block | ✅ have (`condition`) |
| Multi-output Switch | Switch node | Condition (multi) | multi transitions | — | ✅ have (`switch_case`) |
| Dedicated message-type router | (via Switch) | (via Condition) | (via expression) | labeled "is voice" | ✅ **add `message_type`** |
| Merge / parallel | Merge node | — | — | — | ❌ skip |
| Loop | Split-in-Batches | — | — | — | 🟡 defer |
| Set var | Set node | Set step | Set var card | — | ✅ have (`set_var`) |
| Extract (regex/JSON) | Code node | functions | Execute Code | plugin | ✅ **add `extract`** |
| Expression/code | Code node | — | Execute Code | — | ✅ **add `expr`** |
| Typing indicator | n/a | — | — | — | ✅ have + auto-wrap |
| Timeout handling | retryOnFail | — | fallback transition | — | ✅ **add `timeoutMs`** |
| Variables panel | per-node JSON | Variables panel | emulator panel | Fields admin | ✅ **add inspector** |
| `{{` autocomplete | Expression editor | yes | yes | picker | ✅ **add** |
| Typed variables | yes | loose | JS | typed | ❌ skip (strings ok) |
| Scoped vars | static+run | conv+global | user/session/temp/bot | user/bot fields | 🟡 defer (per-user, global) |
| Sub-flow | Execute Workflow | — | route to workflow | — | 🟡 defer |
| Delete/Forward/Pin | — | — | — | — | ❌ niche/skip |

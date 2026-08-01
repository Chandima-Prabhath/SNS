# LLM Function Calling (Tool Use) for the Visual Bot Builder

Research into adding "LLM picks the path" / function-calling support to the
Next.js + ReactFlow bot builder, targeting a **locally-running Ollama** stack
(`gemma3:270m`, `llama3.2`, etc.).

Findings are practical: every recommendation is evaluated against what a
**270M-parameter model** can actually do, not what GPT-4 can do.

---

## TL;DR / Executive summary

| Question | Answer |
|---|---|
| Does Ollama support native tool calling? | **Yes.** Since Jul 2024. `tools` array in request → `tool_calls` in response. OpenAI-compatible `/v1` endpoint also supports it. |
| Does `gemma3:270m` support it? | **No.** It is not on the Tools-capable model list and is far too small for reliable native tool use. |
| Is there a 270M model that *does*? | **Yes — `functiongemma` (270M)**, a Google fine-tune of Gemma 3 270M specifically for function calling. BUT it is **function-calling-only**, *not* a dialogue model. |
| Minimum model for *reliable* native tool calling? | ~**7B** (llama3.1:8b, qwen2.5:3b/7b, mistral-nemo:12b). Docker's benchmark shows even 8B models still hallucinate tool picks / args ~20–40% of the time. |
| Best pattern for `gemma3:270m`? | **Structured-output classification → `switch_case`** (Botpress "AI Transition" pattern). Force JSON `{ "intent": "play_music" }` via Ollama's `format` schema, then route with the existing `switch_case` node. |
| Recommended MVP node | A new **`ai_route`** node (a thin wrapper around Ollama `format`+JSON-schema) whose single output feeds the **existing `switch_case`**. Cheapest, most reliable, works with *every* model including 270M. |
| Recommended "real" tool-use node | An **`ai_tool_call`** node that uses Ollama native `tools` + `tool_calls`, with **one output handle per tool**. Use with `llama3.1:8b` / `qwen3` / `functiongemma`. |

**Bottom line:** `gemma3:270m` cannot do reliable native tool use. The single
most robust, model-agnostic thing you can build is **structured-output intent
classification → `switch_case` routing**. Add native `tool_calls` later as an
upgrade path for users running 8B+ models.

---

## 1. Ollama function calling support

### 1.1 Yes, it's a first-class feature

From the Ollama docs (`docs.ollama.com/capabilities/tool-calling`) and the
"Tool support" blog post (Jul 25, 2024):

> "Ollama supports tool calling (also known as function calling) which allows a
> model to invoke tools and incorporate their results into its replies."

It works on both endpoints:

- **Native `/api/chat`** — pass a `tools` array.
- **OpenAI-compatible `/v1/chat/completions`** — pass `tools` / `tool_choice` / `response_format` (the OpenAI shape). Lets you swap models freely.

### 1.2 The API format

**Request** (`/api/chat`):

```jsonc
{
  "model": "qwen3",
  "stream": false,
  "messages": [{ "role": "user", "content": "What is the temperature in New York?" }],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_temperature",
        "description": "Get the current temperature for a city",
        "parameters": {
          "type": "object",
          "required": ["city"],
          "properties": {
            "city": { "type": "string", "description": "The name of the city" }
          }
        }
      }
    }
  ]
}
```

**Response** — supported models return a `tool_calls` array instead of (or
alongside) plain `content`:

```jsonc
{
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      {
        "type": "function",
        "function": {
          "name": "get_temperature",
          "arguments": { "city": "New York" }
        }
      }
    ]
  }
}
```

**Closing the loop** — you execute the tool and feed the result back with a
`tool`-role message:

```jsonc
{
  "role": "tool",
  "tool_name": "get_temperature",
  "content": "22°C"
}
```

Ollama supports both **single-shot** (one tool call) and **parallel** (multiple
tool calls in one response) flows. Streaming tool calls are also supported
(May 2025).

### 1.3 Which models support tool use

Models listed under Ollama's **Tools** category (`ollama.com/search?c=tools`):

| Model | Size class | Notes |
|---|---|---|
| **Llama 3.1 / 3.2 / 3.3** | 8B – 405B | The reference tool-capable family. `llama3.1:8b` is the practical floor. |
| **Qwen 2.5 / 3** | 3B – 72B | Qwen2.5-3B is the smallest *general* model with decent tool use. |
| **Mistral / Mistral-Nemo** | 7B / 12B | Nemo (12B) is strong; Mistral 7B is "impressive with lower resources" (Collabnix). |
| **Command-R / Command-R+** | 35B / 104B | Cohere; built for RAG + tool use. |
| **Firefunction v2** | 7B | Function-calling fine-tune of Llama 3. |
| **IBM Granite** | 3B / 8B (granite3.2-dense) | "Designed to support tool-based use cases." |
| **`functiongemma`** | **270M** | Gemma 3 270M fine-tuned for **function calling only**. |

### 1.4 `gemma3:270m` and tool use — the honest answer

**`gemma3:270m` does NOT support tool use.** It is a general instruction/chat
model and is not on the Tools-capable list. At 270M parameters it cannot
reliably hold the tool-schema grammar in working memory — Docker's local-LLM
tool-calling evaluation found that even **8B** models (xLAM-2-8b-fc-r,
watt-tool-8B) fail in recurring ways:

- *Eager invocation* — calling tools for "Hi there!"
- *Wrong tool selection* — searching when it should add
- *Invalid arguments* — missing/malformed params
- *Ignored responses* — failing to react to tool output

A 270M model will be dramatically worse on all four axes. **Do not build your
MVP around `gemma3:270m` doing native `tool_calls`.**

### 1.5 The exception: `functiongemma` (270M)

Google released **FunctionGemma** — the same Gemma 3 270M architecture,
fine-tuned explicitly for text-only function calling.

- Pull: `ollama pull functiongemma` (301 MB, 32K context, requires Ollama v0.13.5+)
- It **does** return `tool_calls` via the standard Ollama `tools` API.
- **Caveat (important):** per the model card, *"FunctionGemma is not intended
  for use as a direct dialogue model, and is designed to be highly performant
  after further fine-tuning."* It emits tool calls; it does **not** chitchat.

So `functiongemma` is a credible **router-only** model at 270M: feed it the
user's message + the tool list, get a `tool_calls` decision, route. Use a
different model for the actual conversational replies.

### 1.6 Minimum model size for reliable tool use

| Size | Reliability for native `tool_calls` |
|---|---|
| 270M (gemma3) | ❌ Not supported. |
| 270M (functiongemma) | ⚠️ Works for **single-turn, single-tool routing** only; not dialogue. Treat as a classifier. |
| 1B – 3B (general) | ⚠️ Possible with Qwen2.5-3B, but unreliable for multi-tool / multi-arg. |
| 7B – 8B (llama3.1:8b, mistral 7B, qwen3) | ✅ The practical floor for "reliable enough" tool use. |
| 12B+ (mistral-nemo, granite 8B) | ✅✅ Solid. |

---

## 2. Structured outputs — the small-model escape hatch

Even when a model can't do `tool_calls`, Ollama can **constrain its output to a
JSON schema**. This is the single most important feature for small-model
routing.

From `docs.ollama.com/capabilities/structured-outputs`:

```jsonc
{
  "model": "gemma3:270m",            // works on basically every model
  "messages": [{ "role": "user", "content": "play bohemian rhapsody" }],
  "stream": false,
  "format": {
    "type": "object",
    "properties": {
      "intent":   { "type": "string", "enum": ["play_music","skip","pause","resume","vote","none"] },
      "argument": { "type": "string" }
    },
    "required": ["intent"]
  },
  "options": { "temperature": 0 }
}
```

The response `content` is **guaranteed** to be valid JSON matching the schema.
This turns any model — including `gemma3:270m` — into a reliable-enough
classifier, because the grammar is enforced at decode time (the model
literally cannot emit tokens that violate the schema).

**Tips for reliability (from Ollama docs + HN discussion):**
- Lower `temperature` to 0 for deterministic routing.
- Echo the schema in the prompt to "ground" the model (helps a lot on small models).
- Keep the `enum` small (≤ 8 intents) — small models degrade fast as the option count grows.
- This also works through the OpenAI-compatible endpoint via `response_format`.

> ⚠️ Structured outputs and reasoning/"thinking" mode are currently mutually
> exclusive on Ollama. Don't combine them.

---

## 3. How other visual bot builders do "LLM picks the path"

### 3.1 Voiceflow — hybrid NLU + LLM intent classification

Voiceflow's primary routing primitive is the **Choice step**, historically fed
by an NLU intent model. They've since added **LLM intent classification**:

- The classifier first runs their encoder NLU to get the **top-10 candidate intents** (with descriptions).
- Those candidates + the user message are sent to an LLM, which picks the best intent.
- The Choice step then branches to the matching path.

Source: `voiceflow.com/stories/benchmarking-hybrid-llm-classification-systems`.

**Takeaway for us:** This is essentially *structured-output classification →
switch*. We don't need the NLU pre-filter (our intent spaces are small), but the
shape — "LLM returns one of N labels, flow branches on the label" — is exactly
right for a small-model bot builder.

### 3.2 Botpress — two complementary patterns

Botpress exposes **two** distinct AI routing mechanisms:

**a) AI Transition card** (`botpress.com/docs/studio/concepts/cards/ai/ai-transition`)

> "The AI Transition card is a specific type of AI Task that helps you classify
> text into a set of predefined categories."

Three fields:
1. **Text to categorize** (e.g. `{{event.preview}}`)
2. **Categories** — the list of labels
3. **Store result in variable** (optional)

Then a regular transition branches on the stored category. Botpress explicitly
says: *"You can use the AI Transition card to replace Intents."*

This is **Pattern A** below and is the closest analog to what we should build.

**b) Autonomous Node** (`botpress.com/docs/studio/concepts/nodes/autonomous-node`)

> "The Autonomous Node uses a Large Language Model (LLM) to decide when to
> execute tools… It can understand the conversation's context, write responses
> to users, and leverage the tools you give it."

Config fields: **Instructions, Variables, Tools, Search Knowledge, Workflows,
Exit Conditions.** The LLM loops, calling tools and workflows as it sees fit,
until an exit condition is met. This is a full **agentic loop** (Pattern B)
and **requires a large model** (GPT-4o-mini is the common choice in their
community).

### 3.3 n8n — AI Agent node with tool sub-nodes

`docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent`:

> "Connect a chat model and one or more tools, and the agent decides which tools
> to call to complete a task."

- The **AI Agent** node has input slots for a **Chat Model** and **Tools**.
- Tools are connected as **sub-nodes** (each tool is its own node on the canvas).
- Internally uses LangChain's "Tools Agent" (formerly ReAct / Functions agent).
- Caveat from the community: n8n converts everything to LangChain's "universal"
  message format, which can mangle tool schemas; tool selection is "spotty"
  with weaker models.

**Takeaway:** n8n's visualization is "agent node + tool sub-nodes hanging off
it." That's a clean mental model but presumes native tool calling + a strong
model.

### 3.4 Flowise / Langflow — agent + tool outputs

Both are node-based LLM orchestration canvases.

**Langflow** (`docs.langflow.org/agents-tools`):

> "To attach a tool to an agent, you connect any component's **Tool output** to
> the **Agent component's Tools input**. Some components emit Tool output by
> default; otherwise you must enable **Tool Mode** in the component's header."

So in Langflow: every component can optionally expose a **"Tool" output handle**
(via a *Tool Mode* toggle), and the Agent component has a **"Tools" input
handle** that collects them. Routing after a tool call is implicit — the agent
loops until done.

**Flowise** similarly composes Agent Chatflow / Sequential Agents from modular
blocks (chat model + tools + memory). Both target the *agentic-loop* pattern
and presume models strong enough to drive it.

### 3.5 Activepieces — branching, not LLM-native tool use

Activepieces is a general automation DAG with **branch/loop** control-flow
nodes. It has AI Agents, but its "LLM picks the path" story is just
**branch on a condition** (where the condition value may have been produced by
an earlier AI step). There's no first-class "tool_calls → branch" primitive.

**Takeaway:** Activepieces confirms that for a non-agentic automation tool, the
pragmatic pattern is "run an AI node that produces a value, then branch on that
value with a normal switch."

### 3.6 Comparison matrix

| Platform | Routing mechanism | Presumes native tool calling? | Needs a big model? | Visualization |
|---|---|---|---|---|
| **Voiceflow** | Choice step + LLM intent classification | No (intent label) | No (works with small LMs via NLU pre-filter) | One outgoing edge per intent |
| **Botpress AI Transition** | Classify text → category → branch | No | No | One outgoing edge per category |
| **Botpress Autonomous Node** | LLM loops, calls tools/workflows | Yes | Yes (GPT-4o-mini+) | Tools listed in config panel |
| **n8n AI Agent** | LangChain Tools Agent | Yes | Yes | Tool sub-nodes attached to agent |
| **Langflow / Flowise** | Agent with Tools input handle | Yes | Yes | Components expose Tool output; wires into Agent |
| **Activepieces** | Branch node on an AI-produced value | No | No | Standard branch/switch |

**The clear pattern split:** platforms split into **(A) classify-then-switch**
(model-agnostic, small-model friendly) and **(B) native tool-calling agent
loop** (requires 7B+ tool-trained models).

---

## 4. Design patterns for "LLM picks the path"

### Pattern A — Structured-output classification → `switch_case`

```
[user msg] → ai_route (forces JSON {intent}) → switch_case (cases=intents) → per-intent sub-flow
```

- The LLM is asked to output **one of N intent labels** (plus optional args) as
  constrained JSON.
- The `intent` string is stored in a variable.
- The existing `switch_case` node branches on it; `default` handle = fallback.

| Aspect | Detail |
|---|---|
| Works with `gemma3:270m`? | ✅ Yes (via Ollama `format` schema). This is the recommended MVP path. |
| Works with `functiongemma:270m`? | ✅ Yes (even better — it's trained for it). |
| Works with `llama3.1:8b`+? | ✅ Yes. |
| Reliability | High for ≤ 8 intents; degrades gracefully. Enforced JSON means no parse failures. |
| Fallback handling | The schema's `enum` includes `"none"`, which hits `switch_case`'s `default` handle. |
| Complexity | Low. Reuses your existing `switch_case` node. |

### Pattern B — Native Ollama `tool_calls` → per-tool output handle

```
[user msg] → ai_tool_call (tools=[...]) ──┬─ tool:play_music ─→ sub-flow
                                           ├─ tool:skip ──────→ sub-flow
                                           └─ (no call) ─────→ default sub-flow
```

- The node sends the real Ollama `tools` array.
- The engine parses `message.tool_calls[0].function.name` and routes to the
  matching output handle.
- Args from `function.arguments` are stored in variables for the sub-flow.

| Aspect | Detail |
|---|---|
| Works with `gemma3:270m`? | ❌ No. |
| Works with `functiongemma:270m`? | ⚠️ Yes for single-tool routing, but no dialogue. |
| Works with `llama3.1:8b` / `qwen3`? | ✅ Yes. |
| Reliability | Medium even at 8B (Docker eval). Needs good prompts + arg validation. |
| Fallback handling | If `tool_calls` is empty → `default` handle. Validate args; on failure → `default` or retry. |
| Complexity | Medium. New node type with dynamic output handles. |

### Pattern C — Free-text → regex/JSON parse → route

```
[user msg] → ai_generate (raw text) → regex_extract / json_parse → switch_case
```

- Just use the existing `ai_generate` node, prompt it to "reply with exactly one
  word: PLAY, SKIP, PAUSE…", then `regex_extract` + `switch_case`.

| Aspect | Detail |
|---|---|
| Works with `gemma3:270m`? | ⚠️ Sometimes. No output guarantee — the model may emit prose, breaking the parse. |
| Reliability | Lowest of the three. Fragile. |
| Complexity | Lowest (no new node needed). |

### Recommendation

- **For `gemma3:270m`: Pattern A.** It's the only one that's both reliable and
  model-agnostic, because the JSON schema is *enforced* by Ollama, not left to
  the model's discipline.
- **For users on 8B+ models: Pattern B.** Offer it as an "Advanced / native
  tools" option. Same UX idea (one output per tool), real `tool_calls`.
- **Avoid Pattern C** for anything user-facing; it's a debugging crutch.

### Handling "no tool matched" / fallback

Three layered strategies (use all three):

1. **Schema-level:** always include a sentinel value in the `enum` (e.g.
   `"none"` / `"fallback"`) so the model always returns *something* valid.
2. **Switch-level:** `switch_case` already has a `default` handle — wire it to a
   "I didn't understand" reply + retry, or a human-handoff node.
3. **Engine-level:** if JSON parse fails (shouldn't with `format`, but…), or a
   `tool_call` references an unknown tool, route to `default` and log it.

---

## 5. Music integration nodes

Given the music player (YouTube-based, Zustand store, rooms), here are the
nodes that map cleanly onto the tool-use pattern. Each is both a **standalone
bot node** *and* a candidate **tool definition** the LLM can pick.

### 5.1 Suggested music nodes

| Node | Inputs | Outputs / side-effects | As an LLM tool |
|---|---|---|---|
| `music_play` | `query` (song/artist), optional `room` | Searches YouTube, enqueues track; sets `{{currentTrack}}` | `play_song({query, room?})` |
| `music_skip` | optional `room` | Skips current track | `skip_song({room?})` |
| `music_pause` / `music_resume` | `room` | Toggles playback | `pause_playback()` / `resume_playback()` |
| `music_now_playing` | `room` | Sets `{{nowPlaying}}` (title, artist, queuedBy) | `get_now_playing({room})` |
| `music_queue_list` | `room` | Sets `{{queue}}` JSON | `list_queue({room})` |
| `music_vote` | `trackId`, `direction` (`up`/`down`), `room` | Adjusts queue order | `vote_track({trackId, direction, room})` |
| `music_create_room` | `roomName` | Creates a listening room; sets `{{roomId}}` | `create_room({name})` |
| `music_join_room` | `roomId` | Joins room | `join_room({roomId})` |

### 5.2 How they connect to the tool-use pattern

These nodes are the **leaf actions** that the per-intent / per-tool sub-flows
lead into. Concretely:

- **Pattern A wiring:**
  `ai_route` → `switch_case` → (case `play_music`) → `music_play` → `send_message("🎵 Now playing: {{currentTrack}}")`
  → (case `skip`) → `music_skip` → `send_message("⏭ Skipped")`
  → (case `none`) → `send_message("Sorry, I can play, skip, pause… what would you like?")`

- **Pattern B wiring:**
  `ai_tool_call` (with `tools=[play_song, skip_song, pause_playback, get_now_playing…]`)
  → output handle `play_song` → `music_play` (args fed from `function.arguments`)
  → output handle `skip_song` → `music_skip`
  → default → fallback reply

### 5.3 Tool definition examples (for the `tools` array)

```jsonc
[
  {
    "type": "function",
    "function": {
      "name": "play_song",
      "description": "Search YouTube and add a song to the music queue.",
      "parameters": {
        "type": "object",
        "required": ["query"],
        "properties": {
          "query": { "type": "string", "description": "Song title and/or artist, e.g. 'Bohemian Rhapsody Queen'" },
          "room":  { "type": "string", "description": "Optional room id; defaults to the current room" }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "skip_song",
      "description": "Skip the currently playing song.",
      "parameters": { "type": "object", "properties": {} }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_now_playing",
      "description": "Return the title and artist of the currently playing song.",
      "parameters": { "type": "object", "properties": {} }
    }
  }
]
```

For **Pattern A**, the equivalent is a single JSON schema with an `intent`
enum derived from the same tool names:

```jsonc
{
  "type": "object",
  "properties": {
    "intent":   { "type": "string", "enum": ["play_song","skip_song","pause","resume","get_now_playing","vote","none"] },
    "argument": { "type": "string", "description": "The song query, vote direction, etc. if applicable" }
  },
  "required": ["intent"]
}
```

---

## 6. Implementation approach for our app

### 6.1 Extend `ai_generate`, or add a new node?

**Add new node types.** `ai_generate` is a "produce text" primitive; overloading
it with tool/routing concerns muddies the canvas. Two new nodes, each with a
single clear job:

1. **`ai_route`** (Pattern A) — the small-model MVP.
2. **`ai_tool_call`** (Pattern B) — the native-tools upgrade for 8B+ models.

This mirrors how Botpress separates "AI Transition" (classify) from
"Autonomous Node" (agent loop). It also keeps the existing `ai_generate` stable.

### 6.2 The `ai_route` node (recommended MVP — works on `gemma3:270m`)

**Responsibility:** turn a free-text user message into one of N intent labels,
using Ollama **structured outputs** (not `tool_calls`).

**Node config fields** (fit the existing `BotNodeData` shape):
- `aiPrompt` — template, defaults to `Classify the user's message:\n\n{{lastMessage}}`
- `aiSystemPrompt` — e.g. "You are a music-bot intent classifier. Pick exactly one intent."
- `aiModel` — `gemma3:270m` (default), `functiongemma`, etc.
- `aiTemperature` — default `0`
- `intents: string[]` — the category list (also drives the output handles + the JSON `enum`)
- `variableName` — where to store the chosen intent (default `intent`)
- `extractArgument: boolean` — also extract a free-text `argument` field

**Output handles:** a single `out` handle → feed into an existing `switch_case`
whose `cases` mirror `intents`. (Keeps `ai_route` itself simple; the branching
lives in `switch_case`, which already supports dynamic cases + `default`.)

**Engine implementation sketch** (mirrors the existing `ai_generate` case in
`flow-types.ts`):

```ts
case 'ai_route': {
  const intents = node.intents ?? []
  const schema = {
    type: 'object',
    properties: {
      intent:   { type: 'string', enum: [...intents, 'none'] },
      argument: { type: 'string' },
    },
    required: ['intent'],
  }
  const resp = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: node.aiModel ?? 'gemma3:270m',
      stream: false,
      format: schema,                 // <-- enforced JSON
      options: { temperature: node.aiTemperature ?? 0 },
      messages: [
        { role: 'system', content: node.aiSystemPrompt ?? '' },
        { role: 'user', content: interpolate(node.aiPrompt, ctx) },
      ],
    }),
  }).then(r => r.json())

  let parsed: { intent: string; argument?: string } = { intent: 'none' }
  try { parsed = JSON.parse(resp.message.content) } catch { parsed = { intent: 'none' } }

  ctx.vars[node.variableName ?? 'intent'] = parsed.intent
  if (parsed.argument) ctx.vars[(node.variableName ?? 'intent') + '_arg'] = parsed.argument
  return [{ handle: 'out' }]
}
```

Then a downstream `switch_case` on `{{intent}}` with `cases = intents` does the
branching — reusing 100% of existing logic.

**Complexity:** Low. ~1 new node type + ~40 lines of engine code. No UI
changes beyond a new node palette entry + an `intents` list editor (reuse the
existing `cases` editor from `switch_case`).

### 6.3 The `ai_tool_call` node (upgrade path — requires 8B+ or `functiongemma`)

**Responsibility:** real Ollama `tool_calls`, one output handle per tool.

**Node config fields:**
- `aiModel` — must be a Tools-capable model. Show a warning in the UI if the
  selected model isn't on the Tools list.
- `tools: ToolDef[]` — name + description + JSON-schema params (edit via a
  small table editor; same shape as the Ollama `tools` array).
- `aiSystemPrompt`, `aiTemperature` (default 0), `aiMaxTokens`.
- Per-tool arg mapping: which variable each tool's args get stored into.

**Output handles:** one handle per tool (`tool_0`, `tool_1`, …) **plus** a
`default` handle for "no tool called / parse failure".

**Engine implementation sketch:**

```ts
case 'ai_tool_call': {
  const resp = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: node.aiModel,            // e.g. 'llama3.1:8b' or 'functiongemma'
      stream: false,
      tools: node.tools.map(t => ({ type: 'function', function: t })),
      options: { temperature: node.aiTemperature ?? 0 },
      messages: [
        { role: 'system', content: node.aiSystemPrompt ?? '' },
        { role: 'user', content: interpolate(node.aiPrompt, ctx) },
      ],
    }),
  }).then(r => r.json())

  const calls = resp.message?.tool_calls ?? []
  if (calls.length === 0) return [{ handle: 'default' }]

  const call = calls[0]                                // single-tool routing
  const idx  = node.tools.findIndex(t => t.name === call.function.name)
  if (idx === -1) return [{ handle: 'default' }]       // unknown tool → fallback

  // store args for the sub-flow
  ctx.vars['tool_name'] = call.function.name
  ctx.vars['tool_args'] = JSON.stringify(call.function.arguments)
  return [{ handle: `tool_${idx}` }]
}
```

**Complexity:** Medium. New node type, dynamic output-handle rendering in
ReactFlow (you already do this for `switch_case`'s `case_N` handles, so the
pattern exists), tool-definition editor, model-capability validation.

### 6.4 Defining "tools" in the UI

Two editing surfaces, consistent with the rest of the builder:

- **`ai_route`:** an `intents` list editor. Each entry = a label + optional
  description (description is appended to the system prompt to help the model).
  Reuse the existing `switch_case` cases editor component.
- **`ai_tool_call`:** a `tools` table editor. Each row = name, description,
  and a params JSON-schema (key/type/description). Provide a few presets
  ("Play song", "Skip", "Get now playing") seeded from §5.3.

### 6.5 Routing after a tool call — one output per tool, or single + switch?

| Option | Pros | Cons |
|---|---|---|
| **One output handle per tool** (`ai_tool_call`) | Visually obvious; matches Langflow/n8n mental model; no extra node needed. | Dynamic handle rendering; wider nodes. |
| **Single output → `switch_case`** (`ai_route`) | Reuses `switch_case` 100%; simpler engine; handles live in one place. | Two nodes on canvas instead of one. |

**Recommendation:** Do **single-output → `switch_case`** for the MVP (`ai_route`),
because it's the only thing that works on 270M and it reuses existing nodes.
Add **one-output-per-tool** (`ai_tool_call`) as the native upgrade, since users
on 8B+ models will expect the Langflow-style visual.

### 6.6 Simplest MVP that works on `gemma3:270m`

1. Add **`ai_route`** node: Ollama `/api/chat` with `format` = intent JSON
   schema, `temperature: 0`. Single `out` handle. Stores `{{intent}}`.
2. Reuse the **existing `switch_case`** for branching (cases = intents).
3. Add the **music leaf nodes** (`music_play`, `music_skip`, `music_now_playing`,
   …) from §5.1 as ordinary action nodes.
4. Ship a **preset flow**: `message → ai_route → switch_case → music_*` so users
   see the pattern immediately.
5. (Optional fast win) Tell users they can `ollama pull functiongemma` and set
   it as the `ai_route` model for noticeably better routing at the same size.

Everything in steps 1–4 works on `gemma3:270m` today, with no dependency on
native tool calling.

---

## 7. Phased roadmap

| Phase | What | Models | Why |
|---|---|---|---|
| **0 — Now** | `ai_route` (structured-output classify) + reuse `switch_case` + music leaf nodes | `gemma3:270m`, `functiongemma` | Works on the smallest model; biggest UX payoff per LOC. |
| **1 — Soon** | `functiongemma` as a recommended router; prebuilt music tool presets | `functiongemma:270m` | Better routing at the same footprint; still local/tiny. |
| **2 — Later** | `ai_tool_call` node (native `tools`/`tool_calls`, one handle per tool) | `llama3.1:8b`, `qwen3`, `mistral-nemo:12b` | Real function calling for users who can run 8B+. |
| **3 — Optional** | Autonomous agent loop node (Botpress-style) | 8B+ tool-trained | Full agentic behavior; out of scope for a friend-group MVP. |

---

## 8. Key gotchas

- **`gemma3:270m` ≠ `functiongemma`.** Same size, different fine-tune. Only the
  latter does tool calls, and only as a classifier (no chitchat).
- **Structured outputs ≠ reasoning mode.** They're mutually exclusive on Ollama
  today; don't try to combine.
- **`format` schema must be echoed in the prompt** for best small-model results
  — ground the model even though the grammar is enforced.
- **Validate `tool_call` args** before acting. Even 8B models produce
  missing/malformed args ~20% of the time (Docker eval). Always have a `default`/fallback.
- **Temperature 0** for routing; allow higher only for the *reply* generation node.
- **OpenAI-compatible endpoint** (`/v1`) is the easiest integration if you ever
  want to swap Ollama for a hosted model — same `tools` / `response_format` shape.
- **Keep intent enums small (≤ 8).** Small models degrade sharply as option
  count grows; split domains into multiple `ai_route` nodes if needed.

---

## 9. Sources

- Ollama tool calling docs — `docs.ollama.com/capabilities/tool-calling`
- Ollama "Tool support" blog (Jul 25, 2024) — `ollama.com/blog/tool-support`
- Ollama structured outputs docs — `docs.ollama.com/capabilities/structured-outputs`
- Ollama "Structured outputs" blog (Dec 6, 2024) — `ollama.com/blog/structured-outputs`
- Ollama streaming tool calls (May 28, 2025) — `ollama.com/blog/streaming-tool`
- `functiongemma` model card — `ollama.com/library/functiongemma`
- Google FunctionGemma announcement — `blog.google/.../functiongemma`
- Docker "Tool Calling with Local LLMs: A Practical Evaluation" (Jun 30, 2025) — `docker.com/blog/local-llm-tool-calling-a-practical-evaluation`
- Collabnix "Best Ollama Models for Function Calling 2025" — `collabnix.com/best-ollama-models-for-function-calling-tools-complete-guide-2025`
- Voiceflow hybrid intent classification — `voiceflow.com/stories/benchmarking-hybrid-llm-classification-systems`
- Botpress AI Transition card — `botpress.com/docs/studio/concepts/cards/ai/ai-transition`
- Botpress Autonomous Node — `botpress.com/docs/studio/concepts/nodes/autonomous-node`
- n8n AI Agent node — `docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent`
- Langflow "Configure tools for agents" — `docs.langflow.org/agents-tools`
- Activepieces branching flows — `resources.activepieces.com/glossary/branching-flows`

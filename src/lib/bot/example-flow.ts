/**
 * Example Bot Flow — "Smart Assistant"
 * ─────────────────────────────────────
 * A demo bot that uses every node type in a logical, interconnected flow.
 * Used by the "Load Example" button in the bot builder.
 *
 * Each node's `data` block includes `type` because the editor's CustomNode
 * component reads `data.type` to determine how to render the node (ReactFlow
 * sets n.type to 'custom' for all custom nodes, so we can't use that).
 */

import type { BotFlow } from './flow-types'

export const EXAMPLE_BOT_FLOW: BotFlow = {
  nodes: [
    // ── TRIGGER ──────────────────────────────────────────────────────
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 400, y: 50 },
      data: {
        type: 'trigger',
        triggerType: 'any_message',
        label: 'Trigger',
      },
    },

    // ── COUNTER (track interactions) ─────────────────────────────────
    {
      id: 'counter-1',
      type: 'counter',
      position: { x: 400, y: 180 },
      data: {
        type: 'counter',
        variable: 'interactionCount',
        increment: 1,
        startValue: 1,
        label: 'Count Interactions',
      },
    },

    // ── FORMAT STRING (build greeting) ───────────────────────────────
    {
      id: 'format-1',
      type: 'format_string',
      position: { x: 400, y: 310 },
      data: {
        type: 'format_string',
        text: '👋 Hi {{sender}}! This is your interaction #{{interactionCount}}. What would you like to do?',
        variableName: 'greeting',
        label: 'Build Greeting',
      },
    },

    // ── MESSAGE (send greeting) ──────────────────────────────────────
    {
      id: 'message-greeting',
      type: 'message',
      position: { x: 400, y: 440 },
      data: {
        type: 'message',
        text: '{{greeting}}',
        label: 'Send Greeting',
      },
    },

    // ── TYPING (natural pause) ───────────────────────────────────────
    {
      id: 'typing-1',
      type: 'typing',
      position: { x: 400, y: 570 },
      data: {
        type: 'typing',
        seconds: 1,
        label: 'Typing Pause',
      },
    },

    // ── WAIT CHOICE (buttons) ────────────────────────────────────────
    {
      id: 'choice-1',
      type: 'wait_choice',
      position: { x: 400, y: 700 },
      data: {
        type: 'wait_choice',
        prompt: 'Choose an option:',
        options: ['Tell a joke', 'Ask AI', 'Play a game', 'Quit'],
        variableName: 'userChoice',
        label: 'Main Menu',
      },
    },

    // ── DELAY (small pause before routing) ───────────────────────────
    {
      id: 'delay-1',
      type: 'delay',
      position: { x: 400, y: 860 },
      data: {
        type: 'delay',
        seconds: 1,
        label: 'Pause Before Routing',
      },
    },

    // ── SWITCH (route based on choice) ───────────────────────────────
    {
      id: 'switch-1',
      type: 'switch_case',
      position: { x: 400, y: 990 },
      data: {
        type: 'switch_case',
        switchVariable: 'userChoice',
        cases: ['Tell a joke', 'Ask AI', 'Play a game', 'Quit'],
        label: 'Route Choice',
      },
    },

    // ══ JOKE PATH ════════════════════════════════════════════════════
    {
      id: 'message-joke',
      type: 'message',
      position: { x: 100, y: 1180 },
      data: {
        type: 'message',
        text: '😂 Why do programmers prefer dark mode? Because light attracts bugs!',
        label: 'Send Joke',
      },
    },

    // ══ AI PATH ══════════════════════════════════════════════════════
    {
      id: 'ai-1',
      type: 'ai_generate',
      position: { x: 300, y: 1180 },
      data: {
        type: 'ai_generate',
        aiPrompt: 'The user said: "{{userChoice}}". Greet them and tell them a fun fact in one sentence.',
        aiSystemPrompt: 'You are a cheerful assistant. Keep responses under 30 words.',
        aiModel: 'gemma3:270m',
        aiTemperature: 0.8,
        aiMaxTokens: 128,
        variableName: 'aiResponse',
        label: 'AI Fun Fact',
      },
    },
    {
      id: 'format-ai',
      type: 'format_string',
      position: { x: 300, y: 1310 },
      data: {
        type: 'format_string',
        text: '🤖 AI says: {{aiResponse}}',
        variableName: 'aiFormatted',
        label: 'Format AI Response',
      },
    },
    {
      id: 'message-ai',
      type: 'message',
      position: { x: 300, y: 1440 },
      data: {
        type: 'message',
        text: '{{aiFormatted}}',
        label: 'Send AI Response',
      },
    },

    // ══ GAME PATH (random branch) ════════════════════════════════════
    {
      id: 'random-1',
      type: 'random',
      position: { x: 500, y: 1180 },
      data: {
        type: 'random',
        label: 'Random Game',
      },
    },
    {
      id: 'message-game1',
      type: 'message',
      position: { x: 450, y: 1380 },
      data: {
        type: 'message',
        text: '🎮 You rolled a dice: it landed on 4! Lucky number.',
        label: 'Game Result 1',
      },
    },
    {
      id: 'message-game2',
      type: 'message',
      position: { x: 600, y: 1380 },
      data: {
        type: 'message',
        text: "🎮 You flipped a coin: it's HEADS! You win!",
        label: 'Game Result 2',
      },
    },

    // ══ QUIT PATH ════════════════════════════════════════════════════
    {
      id: 'log-quit',
      type: 'log',
      position: { x: 700, y: 1180 },
      data: {
        type: 'log',
        logMessage: 'User {{sender}} quit after {{interactionCount}} interactions.',
        logLevel: 'info',
        label: 'Log Quit',
      },
    },
    {
      id: 'setvar-reset',
      type: 'set_var',
      position: { x: 700, y: 1310 },
      data: {
        type: 'set_var',
        variable: 'interactionCount',
        value: '0',
        label: 'Reset Counter',
      },
    },
    {
      id: 'message-goodbye',
      type: 'message',
      position: { x: 700, y: 1440 },
      data: {
        type: 'message',
        text: '👋 Goodbye, {{sender}}! Your counter has been reset. Send any message to start again.',
        label: 'Say Goodbye',
      },
    },
    {
      id: 'stop-1',
      type: 'stop',
      position: { x: 700, y: 1570 },
      data: {
        type: 'stop',
        label: 'Stop',
      },
    },

    // ══ DEFAULT PATH (invalid choice — shouldn't happen with buttons, but handles typed input) ══
    {
      id: 'message-invalid',
      type: 'message',
      position: { x: 900, y: 1180 },
      data: {
        type: 'message',
        text: "🤔 I didn't understand that. Please pick one of the options below.",
        label: 'Invalid Choice',
      },
    },

    // ══ API CALL (bonus — fetch a public API as a demo) ══════════════
    {
      id: 'api-1',
      type: 'api_call',
      position: { x: 900, y: 1440 },
      data: {
        type: 'api_call',
        url: 'https://official-joke-api.appspot.com/random_joke',
        method: 'GET',
        variableName: 'jokeApiResult',
        label: 'Fetch Joke API',
      },
    },

    // ══ SEND MEDIA (bonus — send an image) ══════════════════════════
    {
      id: 'media-1',
      type: 'send_media',
      position: { x: 900, y: 1570 },
      data: {
        type: 'send_media',
        mediaUrl: 'https://emojicdn.elk.sh/%F0%9F%8E%89',
        caption: "Here's a party emoji to celebrate! 🎉",
        mediaType: 'image',
        label: 'Send Emoji',
      },
    },
  ],
  edges: [
    // Main flow
    { id: 'e1', source: 'trigger-1', target: 'counter-1' },
    { id: 'e2', source: 'counter-1', target: 'format-1' },
    { id: 'e3', source: 'format-1', target: 'message-greeting' },
    { id: 'e4', source: 'message-greeting', target: 'typing-1' },
    { id: 'e5', source: 'typing-1', target: 'choice-1' },
    { id: 'e6', source: 'choice-1', target: 'delay-1' },
    { id: 'e7', source: 'delay-1', target: 'switch-1' },

    // Switch cases
    { id: 'e8', source: 'switch-1', target: 'message-joke', sourceHandle: 'case_0' },
    { id: 'e9', source: 'switch-1', target: 'ai-1', sourceHandle: 'case_1' },
    { id: 'e10', source: 'switch-1', target: 'random-1', sourceHandle: 'case_2' },
    { id: 'e11', source: 'switch-1', target: 'log-quit', sourceHandle: 'case_3' },
    { id: 'e12', source: 'switch-1', target: 'message-invalid', sourceHandle: 'default' },

    // Joke path — loops back to choice
    { id: 'e13', source: 'message-joke', target: 'choice-1' },

    // AI path
    { id: 'e14', source: 'ai-1', target: 'format-ai' },
    { id: 'e15', source: 'format-ai', target: 'message-ai' },
    { id: 'e16', source: 'message-ai', target: 'choice-1' },

    // Random game paths — both loop back to choice
    { id: 'e17', source: 'random-1', target: 'message-game1', sourceHandle: null },
    { id: 'e18', source: 'random-1', target: 'message-game2', sourceHandle: null },
    { id: 'e19', source: 'message-game1', target: 'choice-1' },
    { id: 'e20', source: 'message-game2', target: 'choice-1' },

    // Quit path
    { id: 'e21', source: 'log-quit', target: 'setvar-reset' },
    { id: 'e22', source: 'setvar-reset', target: 'message-goodbye' },
    { id: 'e23', source: 'message-goodbye', target: 'stop-1' },

    // Default path — also loops back to choice
    { id: 'e24', source: 'message-invalid', target: 'api-1' },
    { id: 'e25', source: 'api-1', target: 'media-1' },
    { id: 'e26', source: 'media-1', target: 'choice-1' },
  ],
}

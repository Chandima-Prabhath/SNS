/**
 * Example Bot Flow — "Smart Assistant"
 * ─────────────────────────────────────
 * A demo bot that uses every node type in a logical, interconnected flow.
 * Used by the "Load Example" button in the bot builder.
 *
 * Layout: main flow runs vertically down the center. Each switch case
 * branches into its own column (joke, AI, game, quit, default) so the
 * connections are clean and the flow direction is obvious. Loop-back
 * edges curve from the bottom of each branch back up to the menu.
 */

import type { BotFlow } from './flow-types'

// Column X positions (280px apart for clean separation)
const X = {
  joke: 40,       // far left
  ai: 320,        // center-left
  main: 600,      // center (main flow)
  game: 880,      // center-right
  quit: 1160,     // right
  default: 1440,  // far right
}

// Row Y positions (140px apart for readability)
const Y = {
  trigger: 40,
  counter: 180,
  format: 320,
  message: 460,
  typing: 600,
  choice: 740,
  delay: 900,
  switch: 1040,
  branch1: 1240,  // first row of branch nodes
  branch2: 1400,  // second row
  branch3: 1560,  // third row
  branch4: 1720,  // fourth row
  branch5: 1880,  // fifth row (TTS)
}

export const EXAMPLE_BOT_FLOW: BotFlow = {
  nodes: [
    // ══ MAIN FLOW (center column) ══════════════════════════════════════
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: X.main, y: Y.trigger },
      data: {
        type: 'trigger',
        triggerType: 'any_message',
        label: 'Trigger',
      },
    },
    {
      id: 'counter-1',
      type: 'counter',
      position: { x: X.main, y: Y.counter },
      data: {
        type: 'counter',
        variable: 'interactionCount',
        increment: 1,
        startValue: 1,
        label: 'Count Interactions',
      },
    },
    {
      id: 'format-1',
      type: 'format_string',
      position: { x: X.main, y: Y.format },
      data: {
        type: 'format_string',
        text: '👋 Hi {{sender}}! This is your interaction #{{interactionCount}}. What would you like to do?',
        variableName: 'greeting',
        label: 'Build Greeting',
      },
    },
    {
      id: 'message-greeting',
      type: 'message',
      position: { x: X.main, y: Y.message },
      data: {
        type: 'message',
        text: '{{greeting}}',
        label: 'Send Greeting',
      },
    },
    {
      id: 'typing-1',
      type: 'typing',
      position: { x: X.main, y: Y.typing },
      data: {
        type: 'typing',
        seconds: 1,
        label: 'Typing Pause',
      },
    },
    {
      id: 'choice-1',
      type: 'wait_choice',
      position: { x: X.main, y: Y.choice },
      data: {
        type: 'wait_choice',
        prompt: 'Choose an option:',
        options: ['Tell a joke', 'Ask AI', 'Play a game', 'Quit'],
        variableName: 'userChoice',
        label: 'Main Menu',
      },
    },
    {
      id: 'delay-1',
      type: 'delay',
      position: { x: X.main, y: Y.delay },
      data: {
        type: 'delay',
        seconds: 0.3,
        label: 'Pause Before Routing',
      },
    },
    {
      id: 'switch-1',
      type: 'switch_case',
      position: { x: X.main, y: Y.switch },
      data: {
        type: 'switch_case',
        switchVariable: 'userChoice',
        cases: ['Tell a joke', 'Ask AI', 'Play a game', 'Quit'],
        label: 'Route Choice',
      },
    },

    // ══ JOKE BRANCH (far left) ═════════════════════════════════════════
    {
      id: 'message-joke',
      type: 'message',
      position: { x: X.joke, y: Y.branch1 },
      data: {
        type: 'message',
        text: '😂 Why do programmers prefer dark mode? Because light attracts bugs!',
        label: 'Send Joke',
      },
    },

    // ══ AI BRANCH (center-left) ════════════════════════════════════════
    {
      id: 'ai-1',
      type: 'ai_generate',
      position: { x: X.ai, y: Y.branch1 },
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
      position: { x: X.ai, y: Y.branch2 },
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
      position: { x: X.ai, y: Y.branch3 },
      data: {
        type: 'message',
        text: '{{aiFormatted}}',
        label: 'Send AI Response',
      },
    },
    {
      id: 'tts-1',
      type: 'tts',
      position: { x: X.ai, y: Y.branch5 },
      data: {
        type: 'tts',
        ttsText: '{{aiResponse}}',
        ttsVoice: 'alba',
        label: 'Speak AI Response',
      },
    },

    // ══ GAME BRANCH (center-right) — random split ══════════════════════
    {
      id: 'random-1',
      type: 'random',
      position: { x: X.game, y: Y.branch1 },
      data: {
        type: 'random',
        label: 'Random Game',
      },
    },
    {
      id: 'message-game1',
      type: 'message',
      position: { x: X.game - 80, y: Y.branch2 },
      data: {
        type: 'message',
        text: '🎮 You rolled a dice: it landed on 4! Lucky number.',
        label: 'Game Result 1',
      },
    },
    {
      id: 'message-game2',
      type: 'message',
      position: { x: X.game + 80, y: Y.branch2 },
      data: {
        type: 'message',
        text: "🎮 You flipped a coin: it's HEADS! You win!",
        label: 'Game Result 2',
      },
    },

    // ══ QUIT BRANCH (right) ═══════════════════════════════════════════
    {
      id: 'log-quit',
      type: 'log',
      position: { x: X.quit, y: Y.branch1 },
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
      position: { x: X.quit, y: Y.branch2 },
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
      position: { x: X.quit, y: Y.branch3 },
      data: {
        type: 'message',
        text: '👋 Goodbye, {{sender}}! Your counter has been reset. Send any message to start again.',
        label: 'Say Goodbye',
      },
    },
    {
      id: 'stop-1',
      type: 'stop',
      position: { x: X.quit, y: Y.branch4 },
      data: {
        type: 'stop',
        label: 'Stop',
      },
    },

    // ══ DEFAULT BRANCH (far right) — invalid choice handling ═══════════
    {
      id: 'message-invalid',
      type: 'message',
      position: { x: X.default, y: Y.branch1 },
      data: {
        type: 'message',
        text: "🤔 I didn't understand that. Please pick one of the options below.",
        label: 'Invalid Choice',
      },
    },
    {
      id: 'api-1',
      type: 'api_call',
      position: { x: X.default, y: Y.branch2 },
      data: {
        type: 'api_call',
        url: 'https://official-joke-api.appspot.com/random_joke',
        method: 'GET',
        variableName: 'jokeApiResult',
        label: 'Fetch Joke API',
      },
    },
    {
      id: 'media-1',
      type: 'send_media',
      position: { x: X.default, y: Y.branch3 },
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
    // Main flow (top to bottom)
    { id: 'e1', source: 'trigger-1', target: 'counter-1' },
    { id: 'e2', source: 'counter-1', target: 'format-1' },
    { id: 'e3', source: 'format-1', target: 'message-greeting' },
    { id: 'e4', source: 'message-greeting', target: 'typing-1' },
    { id: 'e5', source: 'typing-1', target: 'choice-1' },
    { id: 'e6', source: 'choice-1', target: 'delay-1' },
    { id: 'e7', source: 'delay-1', target: 'switch-1' },

    // Switch cases — fan out to 5 columns
    { id: 'e8', source: 'switch-1', target: 'message-joke', sourceHandle: 'case_0' },
    { id: 'e9', source: 'switch-1', target: 'ai-1', sourceHandle: 'case_1' },
    { id: 'e10', source: 'switch-1', target: 'random-1', sourceHandle: 'case_2' },
    { id: 'e11', source: 'switch-1', target: 'log-quit', sourceHandle: 'case_3' },
    { id: 'e12', source: 'switch-1', target: 'message-invalid', sourceHandle: 'default' },

    // Joke branch — loops back to menu
    { id: 'e13', source: 'message-joke', target: 'choice-1' },

    // AI branch
    { id: 'e14', source: 'ai-1', target: 'format-ai' },
    { id: 'e15', source: 'format-ai', target: 'message-ai' },
    { id: 'e16', source: 'message-ai', target: 'tts-1' },
    { id: 'e16b', source: 'tts-1', target: 'choice-1' },

    // Game branch — random splits to 2, both loop back
    { id: 'e17', source: 'random-1', target: 'message-game1', sourceHandle: null },
    { id: 'e18', source: 'random-1', target: 'message-game2', sourceHandle: null },
    { id: 'e19', source: 'message-game1', target: 'choice-1' },
    { id: 'e20', source: 'message-game2', target: 'choice-1' },

    // Quit branch — terminates
    { id: 'e21', source: 'log-quit', target: 'setvar-reset' },
    { id: 'e22', source: 'setvar-reset', target: 'message-goodbye' },
    { id: 'e23', source: 'message-goodbye', target: 'stop-1' },

    // Default branch — also loops back to menu
    { id: 'e24', source: 'message-invalid', target: 'api-1' },
    { id: 'e25', source: 'api-1', target: 'media-1' },
    { id: 'e26', source: 'media-1', target: 'choice-1' },
  ],
}

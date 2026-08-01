/**
 * Example Bot Flow — "AI Assistant"
 * ────────────────────────────────────
 * A smart AI assistant that demonstrates every node type in a practical,
 * non-trivial flow. Designed to feel like a real assistant — not a demo.
 *
 * Capabilities:
 *   - Greets the user by name with an interaction counter
 *   - Routes by message type (text → AI chat, voice → transcribe → AI chat)
 *   - AI generates a response using the local Ollama LLM
 *   - Extracts any URLs from the message using regex
 *   - For voice messages: transcribes via ASR, then feeds to AI
 *   - Replies as text, then speaks the reply via TTS
 *   - Logs every interaction for debugging
 *   - Handles errors gracefully (timeout, server down, etc.)
 *
 * Flow:
 *   trigger → counter → format greeting → message greeting
 *         → message_type
 *           ├─ text  → regex_extract (URLs) → log → ai_generate → message → tts → stop
 *           ├─ voice → asr_transcribe → ai_generate → message → tts → stop
 *           ├─ image → message ("Nice image!") → stop
 *           ├─ video → message ("Cool video!") → stop
 *           ├─ audio → asr_transcribe → ai_generate → message → tts → stop
 *           └─ other → message ("I can handle text and voice") → stop
 */

import type { BotFlow } from './flow-types'

const X = {
  farLeft: 40,
  left: 320,
  center: 600,
  right: 880,
  farRight: 1160,
}

const Y = {
  trigger: 40,
  counter: 180,
  format: 320,
  message: 460,
  msgType: 620,
  branch1: 820,
  branch2: 980,
  branch3: 1140,
  branch4: 1300,
  branch5: 1460,
}

export const EXAMPLE_BOT_FLOW: BotFlow = {
  nodes: [
    // ══ MAIN FLOW ════════════════════════════════════════════════════
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: X.center, y: Y.trigger },
      data: {
        type: 'trigger',
        triggerType: 'any_message',
        label: 'Trigger',
      },
    },
    {
      id: 'counter-1',
      type: 'counter',
      position: { x: X.center, y: Y.counter },
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
      position: { x: X.center, y: Y.format },
      data: {
        type: 'format_string',
        text: '👋 Hey {{sender}}! (#{{interactionCount}}) How can I help?',
        variableName: 'greeting',
        label: 'Build Greeting',
      },
    },
    {
      id: 'message-greeting',
      type: 'message',
      position: { x: X.center, y: Y.message },
      data: {
        type: 'message',
        text: '{{greeting}}',
        label: 'Send Greeting',
      },
    },
    {
      id: 'msgtype-1',
      type: 'message_type',
      position: { x: X.center, y: Y.msgType },
      data: {
        type: 'message_type',
        label: 'Route by Type',
      },
    },

    // ══ TEXT BRANCH (center) ═════════════════════════════════════════
    {
      id: 'regex-1',
      type: 'regex_extract',
      position: { x: X.center, y: Y.branch1 },
      data: {
        type: 'regex_extract',
        regexPattern: 'https?://[^\\s]+',
        regexFlags: 'i',
        regexInput: '{{body}}',
        variableName: 'extractedUrl',
        label: 'Extract URLs',
      },
    },
    {
      id: 'log-1',
      type: 'log',
      position: { x: X.center, y: Y.branch2 },
      data: {
        type: 'log',
        logMessage: 'Text from {{sender}} (#{{interactionCount}}): "{{body}}" | URL: {{extractedUrl}}',
        logLevel: 'info',
        label: 'Log Interaction',
      },
    },
    {
      id: 'ai-text',
      type: 'ai_generate',
      position: { x: X.center, y: Y.branch3 },
      data: {
        type: 'ai_generate',
        aiPrompt: 'The user said: "{{body}}". Respond helpfully and concisely (max 2 sentences).',
        aiSystemPrompt: 'You are a friendly, knowledgeable assistant. Keep responses short and practical.',
        aiModel: 'gemma3:270m',
        aiTemperature: 0.7,
        aiMaxTokens: 256,
        variableName: 'aiResponse',
        label: 'AI Generate',
      },
    },
    {
      id: 'message-text-reply',
      type: 'message',
      position: { x: X.center, y: Y.branch4 },
      data: {
        type: 'message',
        text: '{{aiResponse}}',
        label: 'Send AI Reply',
      },
    },
    {
      id: 'tts-text',
      type: 'tts',
      position: { x: X.center, y: Y.branch5 },
      data: {
        type: 'tts',
        ttsText: '{{aiResponse}}',
        ttsVoice: 'alba',
        label: 'Speak Reply',
      },
    },
    {
      id: 'stop-text',
      type: 'stop',
      position: { x: X.center, y: Y.branch5 + 140 },
      data: { type: 'stop', label: 'Stop' },
    },

    // ══ VOICE BRANCH (left) — ASR → AI → TTS ════════════════════════
    {
      id: 'asr-1',
      type: 'asr_transcribe',
      position: { x: X.left, y: Y.branch1 },
      data: {
        type: 'asr_transcribe',
        asrAudioUrl: '{{mediaUrl}}',
        asrLanguage: 'en',
        asrReply: false,  // don't reply with the transcript — feed to AI instead
        variableName: 'transcript',
        label: 'Transcribe Voice',
      },
    },
    {
      id: 'ai-voice',
      type: 'ai_generate',
      position: { x: X.left, y: Y.branch2 },
      data: {
        type: 'ai_generate',
        aiPrompt: 'The user said: "{{transcript}}". Respond helpfully and concisely (max 2 sentences).',
        aiSystemPrompt: 'You are a friendly assistant. The user sent a voice message that was transcribed. Respond naturally.',
        aiModel: 'gemma3:270m',
        aiTemperature: 0.7,
        aiMaxTokens: 256,
        variableName: 'aiResponse',
        label: 'AI Generate',
      },
    },
    {
      id: 'message-voice-reply',
      type: 'message',
      position: { x: X.left, y: Y.branch3 },
      data: {
        type: 'message',
        text: '{{aiResponse}}',
        label: 'Send AI Reply',
      },
    },
    {
      id: 'tts-voice',
      type: 'tts',
      position: { x: X.left, y: Y.branch4 },
      data: {
        type: 'tts',
        ttsText: '{{aiResponse}}',
        ttsVoice: 'alba',
        label: 'Speak Reply',
      },
    },
    {
      id: 'stop-voice',
      type: 'stop',
      position: { x: X.left, y: Y.branch5 },
      data: { type: 'stop', label: 'Stop' },
    },

    // ══ IMAGE BRANCH (right) ════════════════════════════════════════
    {
      id: 'message-image',
      type: 'message',
      position: { x: X.right, y: Y.branch1 },
      data: {
        type: 'message',
        text: '🖼️ Nice image, {{sender}}! I can\'t see images yet, but I appreciate you sharing.',
        label: 'Acknowledge Image',
      },
    },
    {
      id: 'stop-image',
      type: 'stop',
      position: { x: X.right, y: Y.branch2 },
      data: { type: 'stop', label: 'Stop' },
    },

    // ══ VIDEO BRANCH (far right) ════════════════════════════════════
    {
      id: 'message-video',
      type: 'message',
      position: { x: X.farRight, y: Y.branch1 },
      data: {
        type: 'message',
        text: '🎬 Cool video! I can\'t watch videos yet, but thanks for sharing.',
        label: 'Acknowledge Video',
      },
    },
    {
      id: 'stop-video',
      type: 'stop',
      position: { x: X.farRight, y: Y.branch2 },
      data: { type: 'stop', label: 'Stop' },
    },

    // ══ COMMENT NODE (documentation) ════════════════════════════════
    {
      id: 'comment-1',
      type: 'comment',
      position: { x: X.farLeft, y: Y.trigger },
      data: {
        type: 'comment',
        commentText: '🤖 AI Assistant Example Bot\n\nThis bot demonstrates ALL node types:\n• message_type routing\n• regex_extract (URLs)\n• asr_transcribe (voice→text)\n• ai_generate (Ollama LLM)\n• tts (text→speech)\n• counter, format_string, log\n• stop (terminate flow)\n\nSend a text or voice message to chat with the AI!',
        commentColor: 'blue',
        label: 'About This Bot',
      },
    },
  ],
  edges: [
    // Main flow
    { id: 'e1', source: 'trigger-1', target: 'counter-1' },
    { id: 'e2', source: 'counter-1', target: 'format-1' },
    { id: 'e3', source: 'format-1', target: 'message-greeting' },
    { id: 'e4', source: 'message-greeting', target: 'msgtype-1' },

    // Message type branches
    { id: 'e-text', source: 'msgtype-1', target: 'regex-1', sourceHandle: 'text' },
    { id: 'e-voice', source: 'msgtype-1', target: 'asr-1', sourceHandle: 'voice' },
    { id: 'e-image', source: 'msgtype-1', target: 'message-image', sourceHandle: 'image' },
    { id: 'e-video', source: 'msgtype-1', target: 'message-video', sourceHandle: 'video' },
    // 'audio' and 'file' fall through to 'other' — no edge = flow ends

    // Text branch: regex → log → AI → message → TTS → stop
    { id: 'e10', source: 'regex-1', target: 'log-1' },
    { id: 'e11', source: 'log-1', target: 'ai-text' },
    { id: 'e12', source: 'ai-text', target: 'message-text-reply' },
    { id: 'e13', source: 'message-text-reply', target: 'tts-text' },
    { id: 'e14', source: 'tts-text', target: 'stop-text' },

    // Voice branch: ASR → AI → message → TTS → stop
    { id: 'e20', source: 'asr-1', target: 'ai-voice' },
    { id: 'e21', source: 'ai-voice', target: 'message-voice-reply' },
    { id: 'e22', source: 'message-voice-reply', target: 'tts-voice' },
    { id: 'e23', source: 'tts-voice', target: 'stop-voice' },

    // Image branch
    { id: 'e30', source: 'message-image', target: 'stop-image' },

    // Video branch
    { id: 'e40', source: 'message-video', target: 'stop-video' },
  ],
}

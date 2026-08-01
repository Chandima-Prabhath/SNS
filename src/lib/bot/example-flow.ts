/**
 * Example Bot Flow — "Smart AI Assistant" (with function calling)
 * ────────────────────────────────────────────────────────────────────
 * A practical AI assistant that uses functiongemma for intent routing
 * and demonstrates ALL node types including music control.
 *
 * How it works:
 *   1. User sends any message (text or voice)
 *   2. If voice: ASR transcribes it first
 *   3. AI Route uses functiongemma to pick an intent:
 *      - play_music → Play Music (searches YouTube + plays on user's device)
 *      - chat       → AI Generate (general conversation) → TTS (speak reply)
 *      - pause      → Pause Music
 *      - skip       → Skip Song
 *      - stop       → Stop Music
 *      - help       → Send help message
 *      - (default)  → AI Generate fallback
 *
 * This bot can actually DO things — control music, answer questions, etc.
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
  msgType: 180,
  asr: 340,
  route: 340,
  branch1: 540,
  branch2: 700,
  branch3: 860,
  branch4: 1020,
}

export const EXAMPLE_BOT_FLOW: BotFlow = {
  nodes: [
    // ══ MAIN FLOW ════════════════════════════════════════════════════
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: X.center, y: Y.trigger },
      data: { type: 'trigger', triggerType: 'any_message', label: 'Trigger' },
    },
    {
      id: 'msgtype-1',
      type: 'message_type',
      position: { x: X.center, y: Y.msgType },
      data: { type: 'message_type', label: 'Route by Type' },
    },

    // ══ VOICE BRANCH — ASR then route ════════════════════════════════
    {
      id: 'asr-1',
      type: 'asr_transcribe',
      position: { x: X.left, y: Y.asr },
      data: {
        type: 'asr_transcribe',
        asrAudioUrl: '{{mediaUrl}}',
        asrLanguage: 'en',
        asrReply: false,
        variableName: 'transcript',
        label: 'Transcribe Voice',
      },
    },

    // ══ AI ROUTE (function calling) ══════════════════════════════════
    {
      id: 'ai-route-1',
      type: 'ai_route',
      position: { x: X.center, y: Y.route },
      data: {
        type: 'ai_route',
        label: 'AI Route (functiongemma)',
        aiRoutePrompt: 'The user said: "{{body}}{{transcript}}". Pick the best intent based on what they want.',
        aiRouteSystemPrompt: 'You are a smart routing assistant. Analyze the user message and pick the most appropriate intent. If they want to play music, pick play_music. If they want to pause, pick pause. If they ask a question, pick chat. If they want help, pick help.',
        aiRouteModel: 'functiongemma',
        aiRouteIntents: ['play_music', 'chat', 'pause', 'skip', 'stop', 'help'],
      },
    },

    // ══ PLAY MUSIC BRANCH ════════════════════════════════════════════
    {
      id: 'music-play-1',
      type: 'music_play',
      position: { x: X.farLeft, y: Y.branch1 },
      data: {
        type: 'music_play',
        musicQuery: '{{body}}{{transcript}}',
        label: 'Play Music',
      },
    },
    {
      id: 'msg-music-playing',
      type: 'message',
      position: { x: X.farLeft, y: Y.branch2 },
      data: {
        type: 'message',
        text: '🎵 Playing that for you now, {{sender}}!',
        label: 'Confirm Playing',
      },
    },

    // ══ CHAT BRANCH — AI generates a response + TTS ══════════════════
    {
      id: 'ai-chat-1',
      type: 'ai_generate',
      position: { x: X.center, y: Y.branch1 },
      data: {
        type: 'ai_generate',
        label: 'AI Generate',
        aiPrompt: 'The user said: "{{body}}{{transcript}}". Respond helpfully and concisely (max 2 sentences).',
        aiSystemPrompt: 'You are a friendly, knowledgeable assistant. Keep responses short and practical.',
        aiModel: 'gemma3:270m',
        aiTemperature: 0.7,
        aiMaxTokens: 256,
        variableName: 'aiResponse',
      },
    },
    {
      id: 'msg-chat-reply',
      type: 'message',
      position: { x: X.center, y: Y.branch2 },
      data: {
        type: 'message',
        text: '{{aiResponse}}',
        label: 'Send AI Reply',
      },
    },
    {
      id: 'tts-chat',
      type: 'tts',
      position: { x: X.center, y: Y.branch3 },
      data: {
        type: 'tts',
        ttsText: '{{aiResponse}}',
        ttsVoice: 'alba',
        label: 'Speak Reply',
      },
    },

    // ══ PAUSE MUSIC BRANCH ═══════════════════════════════════════════
    {
      id: 'music-pause-1',
      type: 'music_pause',
      position: { x: X.right, y: Y.branch1 },
      data: { type: 'music_pause', label: 'Pause Music' },
    },
    {
      id: 'msg-paused',
      type: 'message',
      position: { x: X.right, y: Y.branch2 },
      data: {
        type: 'message',
        text: '⏸️ Music paused.',
        label: 'Confirm Pause',
      },
    },

    // ══ SKIP BRANCH ══════════════════════════════════════════════════
    {
      id: 'music-skip-1',
      type: 'music_skip',
      position: { x: X.farRight, y: Y.branch1 },
      data: { type: 'music_skip', label: 'Skip Song' },
    },
    {
      id: 'msg-skipped',
      type: 'message',
      position: { x: X.farRight, y: Y.branch2 },
      data: {
        type: 'message',
        text: '⏭️ Skipped to the next song.',
        label: 'Confirm Skip',
      },
    },

    // ══ STOP MUSIC BRANCH ════════════════════════════════════════════
    {
      id: 'music-stop-1',
      type: 'music_stop',
      position: { x: X.farRight, y: Y.branch3 },
      data: { type: 'music_stop', label: 'Stop Music' },
    },
    {
      id: 'msg-stopped',
      type: 'message',
      position: { x: X.farRight, y: Y.branch4 },
      data: {
        type: 'message',
        text: '⏹️ Music stopped.',
        label: 'Confirm Stop',
      },
    },

    // ══ HELP BRANCH ══════════════════════════════════════════════════
    {
      id: 'msg-help',
      type: 'message',
      position: { x: X.left, y: Y.branch3 },
      data: {
        type: 'message',
        text: '🤖 I\'m your AI assistant! I can:\n\n• Play music — say "play [song name]"\n• Pause music — say "pause"\n• Skip song — say "skip"\n• Stop music — say "stop"\n• Chat — ask me anything!\n\nTry sending a voice message or text!',
        label: 'Help Message',
      },
    },

    // ══ COMMENT (documentation) ══════════════════════════════════════
    {
      id: 'comment-1',
      type: 'comment',
      position: { x: X.farLeft, y: Y.trigger },
      data: {
        type: 'comment',
        commentText: '🤖 Smart AI Assistant\n\nUses functiongemma for intent routing.\nCan control music, answer questions, and more.\n\nRequires: ollama pull functiongemma\n           ollama pull gemma3:270m',
        commentColor: 'blue',
        label: 'About This Bot',
      },
    },
  ],
  edges: [
    // Main flow
    { id: 'e1', source: 'trigger-1', target: 'msgtype-1' },

    // Message type routing
    { id: 'e-voice', source: 'msgtype-1', target: 'asr-1', sourceHandle: 'voice' },
    { id: 'e-text', source: 'msgtype-1', target: 'ai-route-1', sourceHandle: 'text' },
    { id: 'e-audio', source: 'msgtype-1', target: 'asr-1', sourceHandle: 'audio' },
    // image/video/other fall through (no edge = flow ends)

    // Voice: ASR → AI Route
    { id: 'e2', source: 'asr-1', target: 'ai-route-1' },

    // AI Route branches (intent_0=play_music, intent_1=chat, intent_2=pause, intent_3=skip, intent_4=stop, intent_5=help)
    { id: 'r0', source: 'ai-route-1', target: 'music-play-1', sourceHandle: 'intent_0' },
    { id: 'r1', source: 'ai-route-1', target: 'ai-chat-1', sourceHandle: 'intent_1' },
    { id: 'r2', source: 'ai-route-1', target: 'music-pause-1', sourceHandle: 'intent_2' },
    { id: 'r3', source: 'ai-route-1', target: 'music-skip-1', sourceHandle: 'intent_3' },
    { id: 'r4', source: 'ai-route-1', target: 'music-stop-1', sourceHandle: 'intent_4' },
    { id: 'r5', source: 'ai-route-1', target: 'msg-help', sourceHandle: 'intent_5' },
    { id: 'r-default', source: 'ai-route-1', target: 'ai-chat-1', sourceHandle: 'default' },

    // Play music branch
    { id: 'e3', source: 'music-play-1', target: 'msg-music-playing' },

    // Chat branch
    { id: 'e4', source: 'ai-chat-1', target: 'msg-chat-reply' },
    { id: 'e5', source: 'msg-chat-reply', target: 'tts-chat' },

    // Pause branch
    { id: 'e6', source: 'music-pause-1', target: 'msg-paused' },

    // Skip branch
    { id: 'e7', source: 'music-skip-1', target: 'msg-skipped' },

    // Stop branch
    { id: 'e8', source: 'music-stop-1', target: 'msg-stopped' },
  ],
}

'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useChannel } from '@/hooks/useChannel'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Reply, X, Send, Image as ImageIcon, Loader2, AudioLines, Sparkles,
  Mic, Plus, Trash2, User, Smile,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/hooks/useConfirm'

interface MessageComposerProps {
  channelId: string
}

export function MessageComposer({ channelId }: MessageComposerProps) {
  const { send, sendTyping, replyTo, setReplyTo } = useChannel(channelId)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [ttsOpen, setTtsOpen] = useState(false)
  const [showActions, setShowActions] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const recorder = useVoiceRecorder({
    onSend: async (url, mediaType) => {
      await send({ body: 'Voice message', mediaUrl: url, mediaType })
    },
  })

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [text])

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus()
  }, [replyTo])

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    try {
      await send({ body: trimmed, replyToId: replyTo?.id || null })
      setText('')
      setReplyTo(null)
      sendTyping(false)
    } catch {
      toast.error('Failed to send message')
    } finally {
      setSending(false)
      // Re-focus on next tick so the textarea is ready for the next message.
      // This fixes the 'focus lost after send' bug — previously the textarea
      // was disabled during sending, the browser dropped focus to <body>, and
      // nothing pulled it back.
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter = send, Shift+Enter = newline (default behavior — fall through)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
      return
    }
    // Ctrl/Cmd+Enter = send (fallback for users who expect it)
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
      return
    }
    // Escape = cancel reply, or clear draft if no reply
    if (e.key === 'Escape') {
      if (replyTo) {
        e.preventDefault()
        setReplyTo(null)
      } else if (text) {
        e.preventDefault()
        setText('')
        sendTyping(false)
      }
      return
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    if (e.target.value.length > 0) sendTyping(true)
    else sendTyping(false)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text.slice(0, 120) || 'Upload failed')
      }
      const data = await res.json()
      await send({
        body: data.type.startsWith('image') ? 'Photo' : 'File',
        mediaUrl: data.url,
        mediaType: data.type,
      })
    } catch (e: any) {
      toast.error(e.message || 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  // Paste handler — if the user pastes an image, upload and send it directly
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (!file) continue
        e.preventDefault()
        setUploading(true)
        try {
          const formData = new FormData()
          formData.append('file', file, `pasted-${Date.now()}.png`)
          const res = await fetch('/api/upload', { method: 'POST', body: formData })
          if (!res.ok) throw new Error('Upload failed')
          const data = await res.json()
          await send({
            body: 'Photo',
            mediaUrl: data.url,
            mediaType: data.type,
          })
        } catch (err: any) {
          toast.error(err.message || 'Paste upload failed')
        } finally {
          setUploading(false)
        }
        return
      }
    }
    // Fall through: plain-text paste (incl. URLs) behaves normally
  }

  // Common emoji set for the desktop picker (no library needed)
  const EMOJI_SET = '😀 😂 ❤️ 👍 🙏 🔥 😎 🥳 🤔 😴 😭 😡 🎉 💀 🤝 👀 🥺 😘 💕 😅 😬 🤯 😇 🙃 😮 😌 🥰 😋 🤗 ✅ ❌ ⚠️ 🔔 📌 💡 🎁 📷 🎬 🎵 ⏰ ⭐ 🌟 ⚡ 🚀 💪 👏 🫡 🤙 👋 💯 🎊 🥂 🍻 🎂 🌈 ☀️ 🌙 ⛄ 🌸 🌹 🍕 🍔 🍟 🥗 🍣 🍦 ☕ 🍺 🎮 🎧 📚 ✈️ 🚗 ⚽ 🏀 🎯 🏆 🎨'.split(' ')

  const handleEmojiPick = (emoji: string) => {
    setText((t) => t + emoji)
    // Keep focus in the textarea so the user can continue typing
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  return (
    <div className="border-t border-border/60 bg-muted/50 backdrop-blur-2xl px-3 md:px-6 pt-3 pb-3 pb-safe relative z-20 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)]">
      {/* Reply banner */}
      {replyTo && (
        <div className="flex items-center gap-3 text-xs bg-background/70 border border-border/60 backdrop-blur-md rounded-xl p-3 mb-2.5 shadow-sm">
          <Reply className="w-4 h-4 shrink-0 text-primary" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-primary">{replyTo.senderName}</div>
            <div className="text-muted-foreground truncate mt-0.5">{replyTo.body}</div>
          </div>
          <button onClick={() => setReplyTo(null)} className="p-1.5 hover:bg-muted rounded-full transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Recording bar replaces the composer pill while recording / uploading */}
      {recorder.isUploading ? (
        <div className="flex items-center justify-center gap-2 bg-background/60 backdrop-blur-xl rounded-[26px] p-3 border border-border/60 shadow-lg text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Sending voice message...
        </div>
      ) : recorder.isRecording ? (
        <div className="flex items-center gap-2 bg-background/60 backdrop-blur-xl rounded-[26px] p-1.5 pl-3 border border-red-500/40 shadow-lg ring-1 ring-red-500/10">
          {/* Pulsing red dot */}
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
          {/* Timer */}
          <span className="text-sm font-mono tabular-nums text-foreground shrink-0 min-w-[3rem]">
            {Math.floor(recorder.seconds / 60)}:{String(recorder.seconds % 60).padStart(2, '0')}
          </span>
          <span className="text-xs text-muted-foreground truncate flex-1">Recording…</span>
          {/* Cancel */}
          <button
            onClick={recorder.cancel}
            className="h-10 px-3 flex items-center gap-1.5 rounded-full text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
            title="Cancel recording"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Cancel</span>
          </button>
          {/* Stop + send */}
          <button
            onClick={recorder.stopAndSend}
            className="h-11 w-11 flex items-center justify-center rounded-full gradient-primary shadow-glow border border-primary/30 transition-transform hover:scale-105 active:scale-95 shrink-0"
            title="Stop and send"
          >
            <Send className="w-5 h-5 text-primary-foreground" />
          </button>
        </div>
      ) : (
        /* Composer bar — on mobile, extra actions are in a popover.
           On desktop, all buttons are inline. */
        <div className="flex items-end gap-1.5 bg-background/60 backdrop-blur-xl rounded-[26px] p-1.5 pl-2 border border-border/60 shadow-lg ring-1 ring-black/5 transition-shadow focus-within:shadow-xl">
          {/* Desktop: inline action buttons */}
          <label
            className="hidden md:flex cursor-pointer w-10 h-10 items-center justify-center rounded-full transition-all shrink-0 text-muted-foreground hover:bg-primary/10 hover:text-primary active:scale-90"
            title="Upload image, video, or audio"
          >
            <ImageIcon className="w-[22px] h-[22px] transition-colors" />
            <input type="file" className="hidden" accept="image/*,video/*,audio/*" onChange={handleUpload} disabled={uploading} />
          </label>

          {/* Emoji picker (desktop only — mobile users have native keyboards) */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="hidden md:flex w-10 h-10 items-center justify-center rounded-full transition-all shrink-0 text-muted-foreground hover:bg-primary/10 hover:text-primary active:scale-90"
                title="Emoji"
              >
                <Smile className="w-[22px] h-[22px] transition-colors" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-2" side="top" align="start">
              <div className="grid grid-cols-8 gap-0.5 text-2xl max-h-64 overflow-y-auto">
                {EMOJI_SET.map((e, i) => (
                  <button
                    key={i}
                    onClick={() => handleEmojiPick(e)}
                    className="hover:bg-accent rounded p-1 transition-colors text-center leading-none"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <button
            onClick={() => setTtsOpen(true)}
            className="hidden md:flex w-10 h-10 items-center justify-center rounded-full transition-all shrink-0 text-muted-foreground hover:bg-primary/10 hover:text-primary active:scale-90"
            title="Send AI voice message"
          >
            <AudioLines className="w-[22px] h-[22px] transition-colors" />
          </button>

          <button
            onClick={recorder.start}
            className="hidden md:flex w-10 h-10 items-center justify-center rounded-full transition-all shrink-0 text-muted-foreground hover:bg-primary/10 hover:text-primary active:scale-90"
            title="Record a voice message"
            aria-label="Record a voice message"
          >
            <Mic className="w-[22px] h-[22px] transition-colors" />
          </button>

          {/* Mobile: single + button that opens a popover with all actions */}
          <div className="md:hidden relative">
            <button
              onClick={() => setShowActions(!showActions)}
              className="w-10 h-10 flex items-center justify-center rounded-full transition-all shrink-0 text-muted-foreground hover:bg-primary/10 hover:text-primary active:scale-90"
              title="More actions"
            >
              {showActions ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
            </button>

            {/* Action popover */}
            {showActions && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowActions(false)} />
                <div className="absolute bottom-14 left-0 z-40 glass-dark rounded-2xl p-2 shadow-2xl min-w-[180px] space-y-1">
                  <label className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-accent/50 cursor-pointer transition-colors">
                    <ImageIcon className="w-5 h-5 text-primary" />
                    <span className="text-sm">Upload</span>
                    <input type="file" className="hidden" accept="image/*,video/*,audio/*" onChange={(e) => { handleUpload(e); setShowActions(false) }} disabled={uploading} />
                  </label>
                  <button
                    onClick={() => { setTtsOpen(true); setShowActions(false) }}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-accent/50 transition-colors text-left"
                  >
                    <AudioLines className="w-5 h-5 text-primary" />
                    <span className="text-sm">AI Voice</span>
                  </button>
                  <button
                    onClick={() => { recorder.start(); setShowActions(false) }}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-accent/50 transition-colors text-left"
                  >
                    <Mic className="w-5 h-5 text-primary" />
                    <span className="text-sm">Record</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Text input — grows up to ~4 lines */}
          <div className="flex-1 min-w-0 bg-transparent rounded-2xl px-3 py-2 flex items-end focus-within:bg-white/5 transition-colors relative">
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Type a message..."
              maxLength={5000}
              className="flex-1 resize-none min-h-[24px] max-h-[160px] bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 text-[16px] leading-relaxed shadow-none placeholder:text-muted-foreground/60"
              rows={1}
            />
            {/* Character counter — only visible when approaching the limit */}
            {text.length > 4500 && (
              <span className={cn(
                'text-[10px] tabular-nums shrink-0 self-end mb-1.5 mr-1',
                text.length >= 5000 ? 'text-red-500' : 'text-muted-foreground'
              )}>
                {text.length}/5000
              </span>
            )}
          </div>

          {/* Send button */}
          <Button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            size="icon"
            className="rounded-full h-11 w-11 shrink-0 transition-transform hover:scale-105 active:scale-95 gradient-primary shadow-glow border border-primary/30 disabled:opacity-40 disabled:shadow-none disabled:scale-100"
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </Button>
        </div>
      )}

      {/* TTS Voice Message Dialog */}
      <TtsDialog
        open={ttsOpen}
        onOpenChange={setTtsOpen}
        onSend={async (url) => {
          await send({
            body: 'Voice message',
            mediaUrl: url,
            mediaType: 'audio',
          })
          setTtsOpen(false)
          toast.success('Voice message sent')
        }}
      />
    </div>
  )
}

/**
 * useVoiceRecorder — hook that manages MediaRecorder state for recording voice
 * messages. Tap the mic to start, tap stop to upload + send, or cancel to
 * discard. The recording is uploaded via /api/upload and sent as a message
 * with mediaType 'audio/webm' (or the browser's best supported format).
 */
function useVoiceRecorder({
  onSend,
}: {
  onSend: (url: string, mediaType: string) => Promise<void>
}) {
  const [isRecording, setIsRecording] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mimeTypeRef = useRef<string>('audio/webm')

  // Stop the timer + release the mic on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const pickMimeType = useCallback(() => {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ]
    for (const t of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
        return t
      }
    }
    return ''
  }, [])

  const stopTracks = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickMimeType()
      mimeTypeRef.current = mimeType || 'audio/webm'
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setSeconds(0)
      timerRef.current = setInterval(() => {
        setSeconds((s) => s + 1)
      }, 1000)
    } catch {
      toast.error('Microphone access denied')
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [pickMimeType])

  const cancel = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      // Detach onstop so the pending send is discarded
      recorder.onstop = null
      try {
        recorder.stop()
      } catch {
        // ignore
      }
    }
    mediaRecorderRef.current = null
    chunksRef.current = []
    setIsRecording(false)
    setSeconds(0)
    stopTracks()
  }, [stopTracks])

  const stopAndSend = useCallback(async () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      cancel()
      return
    }
    const mime = mimeTypeRef.current
    const blobPromise = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' })
        resolve(blob)
      }
    })
    try {
      recorder.stop()
    } catch {
      cancel()
      return
    }
    setIsRecording(false)
    stopTracks()
    setIsUploading(true)
    try {
      const blob = await blobPromise
      if (blob.size === 0) {
        toast.error('Recording was empty')
        return
      }
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'
      const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type || mime })
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const t = await res.text().catch(() => 'Upload failed')
        throw new Error(t.slice(0, 120) || 'Upload failed')
      }
      const data = await res.json()
      // ALWAYS use the MIME type we recorded with (from MediaRecorder), NOT
      // data.type from the upload response. The upload route returns
      // file.type which can come back as 'video/webm' (WebM is primarily a
      // video container) or 'application/octet-stream' (if the type is lost
      // in FormData serialization). Either of those would cause the message
      // to render as a <video> element (black square) instead of our custom
      // VoiceMessagePlayer. We KNOW we recorded audio, so use mime directly.
      await onSend(data.url, mime || 'audio/webm')
      toast.success('Voice message sent')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send voice message')
    } finally {
      setIsUploading(false)
      setSeconds(0)
      chunksRef.current = []
      mediaRecorderRef.current = null
    }
  }, [cancel, onSend, stopTracks])

  return { isRecording, isUploading, seconds, start, cancel, stopAndSend }
}

/**
 * TTS Dialog — lets the user type text, pick a voice (built-in or custom),
 * preview, and send. Also supports creating custom voices from audio clips.
 */
function TtsDialog({
  open,
  onOpenChange,
  onSend,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onSend: (url: string) => Promise<void>
}) {
  const [tab, setTab] = useState<'generate' | 'voices'>('generate')
  const [text, setText] = useState('')
  const [voice, setVoice] = useState('alba')
  const [selectedCustomVoiceId, setSelectedCustomVoiceId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [sending, setSending] = useState(false)
  const qc = useQueryClient()

  // Fetch built-in voices from the API (single source of truth for labels)
  const { data: builtinVoicesData } = useQuery({
    queryKey: ['tts-builtin-voices'],
    queryFn: async () => {
      const res = await fetch('/api/tts')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    enabled: open,
  })
  const builtinVoices: { id: string; name: string; language: string; gender: string }[] =
    builtinVoicesData?.voices || []

  // Fetch custom voices
  const { data: customVoicesData } = useQuery({
    queryKey: ['tts-voices'],
    queryFn: async () => {
      const res = await fetch('/api/tts/voices')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    enabled: open,
  })
  const customVoices = customVoicesData?.voices || []

  const handleGenerate = async () => {
    if (!text.trim() || generating) return
    setGenerating(true)
    // Clear any previous preview (revoke blob URL to avoid leaks)
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPreviewBlob(null)
    setIsStreaming(true)
    try {
      const body: any = { text }
      if (selectedCustomVoiceId) {
        body.customVoiceId = selectedCustomVoiceId
      } else {
        body.voice = voice
      }
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }))
        throw new Error(err.error || 'Generation failed')
      }

      // The API route streams the TTS audio directly (no server-side save).
      // We read the stream for TWO purposes simultaneously:
      //   1. Instant playback via Web Audio API (chunks played as they arrive)
      //   2. Collect ALL chunks into a Blob for upload when the user sends
      //
      // When the user clicks "Send", we upload the Blob to /api/upload which
      // saves synchronously and returns a URL. This avoids the race condition
      // where a background server-side save hadn't finished before the
      // message URL was accessed (which caused 0-length audio in production).
      const reader = res.body!.getReader()
      let audioCtx: AudioContext | null = null
      let headerParsed = false
      let headerBuf = new Uint8Array(44)
      let headerBytes = 0
      let pcmBuffer = new Uint8Array(0)
      let sampleRate = 24000
      let nextStartTime = 0
      const collectedChunks: Uint8Array[] = []

      const playChunk = (data: Uint8Array) => {
        if (!audioCtx) return
        const samples = Math.floor(data.length / 2)
        if (samples === 0) return
        const audioBuffer = audioCtx.createBuffer(1, samples, sampleRate)
        const int16 = new Int16Array(data.buffer, data.byteOffset, samples)
        const channelData = audioBuffer.getChannelData(0)
        for (let i = 0; i < samples; i++) {
          channelData[i] = int16[i] / 32768
        }
        const source = audioCtx.createBufferSource()
        source.buffer = audioBuffer
        source.connect(audioCtx.destination)
        const startTime = Math.max(audioCtx.currentTime, nextStartTime)
        source.start(startTime)
        nextStartTime = startTime + audioBuffer.duration
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          // Collect every chunk for the final Blob
          collectedChunks.push(value)

          if (!headerParsed) {
            const needed = 44 - headerBytes
            const copy = Math.min(needed, value.length)
            headerBuf.set(value.slice(0, copy), headerBytes)
            headerBytes += copy
            if (headerBytes >= 44) {
              const view = new DataView(headerBuf.buffer)
              sampleRate = view.getUint32(24, true)
              headerParsed = true
              if (!audioCtx) {
                audioCtx = new AudioContext({ latencyHint: 'playback' })
              }
              if (value.length > copy) {
                pcmBuffer = new Uint8Array(value.slice(copy))
              }
            }
          } else {
            const merged = new Uint8Array(pcmBuffer.length + value.length)
            merged.set(pcmBuffer)
            merged.set(value, pcmBuffer.length)
            if (merged.length >= 16384) {
              playChunk(merged)
              pcmBuffer = new Uint8Array(0)
            } else {
              pcmBuffer = merged
            }
          }
        }
      }
      if (pcmBuffer.length > 0) playChunk(pcmBuffer)

      // Build the final Blob from all collected chunks and create a blob URL
      // for the preview player. The Blob is kept in state so handleSend can
      // upload it to /api/upload.
      const wavBlob = new Blob(collectedChunks as BlobPart[], { type: 'audio/wav' })
      console.log(`[tts] collected ${collectedChunks.length} chunks, blob size = ${wavBlob.size} bytes`)
      if (wavBlob.size === 0) {
        throw new Error('TTS produced empty audio (0 bytes collected from stream)')
      }
      const blobUrl = URL.createObjectURL(wavBlob)
      setPreviewBlob(wavBlob)
      setPreviewUrl(blobUrl)
      setIsStreaming(false)
      toast.success('Voice generated — preview and send')
    } catch (e: any) {
      setIsStreaming(false)
      toast.error(e.message || 'Failed to generate voice')
    } finally {
      setGenerating(false)
    }
  }

  const handleSend = async () => {
    if (!previewBlob || sending) return
    setSending(true)
    try {
      // Upload the collected Blob to /api/upload.
      const formData = new FormData()
      formData.append('file', previewBlob, `tts-${Date.now()}.wav`)
      console.log('[tts] uploading blob, size=', previewBlob.size, 'type=', previewBlob.type)
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })
      if (!uploadRes.ok) {
        const errText = await uploadRes.text().catch(() => 'unknown')
        console.error('[tts] upload failed:', uploadRes.status, errText)
        throw new Error(`Upload failed (${uploadRes.status}): ${errText.slice(0, 100)}`)
      }
      const data = await uploadRes.json()
      console.log('[tts] upload success, url=', data.url)

      // Revoke the blob URL — the uploaded file URL is now the source of truth
      if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)

      await onSend(data.url)
      setText('')
      setPreviewUrl(null)
      setPreviewBlob(null)
    } catch (e: any) {
      console.error('[tts] send failed:', e)
      toast.error(e?.message || 'Failed to send voice message')
    } finally {
      setSending(false)
    }
  }

  const handleClose = (o: boolean) => {
    if (!o) {
      setText('')
      if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      setPreviewBlob(null)
      setSelectedCustomVoiceId(null)
    }
    onOpenChange(o)
  }

  // Format a built-in voice as "Name (Language, Gender)" for the dropdown
  const formatVoice = (v: { name: string; language: string; gender: string }) => {
    const gender = v.gender.charAt(0).toUpperCase() + v.gender.slice(1)
    return `${v.name} (${v.language}, ${gender})`
  }

  const builtinSelect = (
    <Select value={voice} onValueChange={setVoice}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {builtinVoices.length === 0 ? (
          <SelectItem value={voice} disabled>
            Loading voices…
          </SelectItem>
        ) : (
          builtinVoices.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {formatVoice(v)}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  )

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Voice Message
          </DialogTitle>
          <DialogDescription>
            Type a message and send it as an AI-generated voice note. Create custom voices from audio clips.
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setTab('generate')}
            className={cn(
              'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'generate' ? 'bg-background text-foreground' : 'text-muted-foreground'
            )}
          >
            Generate
          </button>
          <button
            onClick={() => setTab('voices')}
            className={cn(
              'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-1.5',
              tab === 'voices' ? 'bg-background text-foreground' : 'text-muted-foreground'
            )}
          >
            My Voices
            {customVoices.length > 0 && (
              <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                {customVoices.length}
              </span>
            )}
          </button>
        </div>

        {tab === 'generate' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type what the voice should say..."
                rows={3}
                maxLength={500}
                className="resize-none"
              />
              <div className="text-xs text-muted-foreground text-right">
                {text.length}/500
              </div>
            </div>

            <div className="space-y-2">
              <Label>Voice</Label>
              {customVoices.length > 0 && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedCustomVoiceId(null)}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors border',
                        !selectedCustomVoiceId
                          ? 'bg-primary/15 text-primary border-primary/30'
                          : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'
                      )}
                    >
                      Built-in
                    </button>
                    <button
                      onClick={() => setSelectedCustomVoiceId(customVoices[0]?.id || null)}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors border',
                        selectedCustomVoiceId
                          ? 'bg-primary/15 text-primary border-primary/30'
                          : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'
                      )}
                    >
                      Custom
                    </button>
                  </div>

                  {selectedCustomVoiceId ? (
                    <Select value={selectedCustomVoiceId} onValueChange={setSelectedCustomVoiceId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {customVoices.map((v: any) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    builtinSelect
                  )}
                </div>
              )}

              {!selectedCustomVoiceId && customVoices.length === 0 && builtinSelect}

              {customVoices.length === 0 && (
                <button
                  onClick={() => setTab('voices')}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  Create a custom voice from your voice clip
                </button>
              )}
            </div>

            {/* Streaming indicator — shown while audio is being generated and played */}
            {isStreaming && (
              <div className="space-y-2">
                <Label>Generating and playing...</Label>
                <div className="flex items-center gap-2 p-3 rounded-xl bg-primary/10 border border-primary/20">
                  <div className="flex gap-1 items-center">
                    <span className="w-1 h-4 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-6 bg-primary rounded-full animate-pulse" style={{ animationDelay: '100ms' }} />
                    <span className="w-1 h-3 bg-primary rounded-full animate-pulse" style={{ animationDelay: '200ms' }} />
                    <span className="w-1 h-5 bg-primary rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                    <span className="w-1 h-4 bg-primary rounded-full animate-pulse" style={{ animationDelay: '400ms' }} />
                  </div>
                </div>
              </div>
            )}

            {/* Preview player — shown after streaming completes */}
            {previewUrl && !isStreaming && (
              <div className="space-y-2">
                <Label>Preview</Label>
                <audio controls src={previewUrl} className="w-full" />
              </div>
            )}
          </div>
        ) : (
          <CustomVoicesTab onUseVoice={(id) => { setSelectedCustomVoiceId(id); setTab('generate') }} />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          {tab === 'generate' && (
            !previewUrl ? (
              <Button onClick={handleGenerate} disabled={!text.trim() || generating}>
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-1.5" />
                    Generate voice
                  </>
                )}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => {
                  if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
                  setPreviewUrl(null)
                  setPreviewBlob(null)
                }} disabled={sending}>
                  Regenerate
                </Button>
                <Button onClick={handleSend} disabled={sending || !previewBlob}>
                  {sending ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-1.5" />
                  )}
                  Send
                </Button>
              </>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Custom Voices tab — lets the user record/upload a voice clip and save it
 * as a custom voice model for one-shot voice cloning.
 */
function CustomVoicesTab({ onUseVoice }: { onUseVoice: (id: string) => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [name, setName] = useState('')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [audioChunks, setAudioChunks] = useState<Blob[]>([])

  const { data: customVoicesData } = useQuery({
    queryKey: ['tts-voices'],
    queryFn: async () => {
      const res = await fetch('/api/tts/voices')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })
  const customVoices = customVoicesData?.voices || []

  const deleteVoice = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/tts/voices/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tts-voices'] })
      toast.success('Voice deleted')
    },
  })

  const saveVoice = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/tts/voices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, audioUrl }),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tts-voices'] })
      toast.success('Custom voice created')
      setName('')
      setAudioUrl(null)
    },
  })

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      setAudioUrl(data.url)
    } catch (e: any) {
      toast.error(e.message || 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => chunks.push(e.data)
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        // Upload the recording
        setUploading(true)
        try {
          const formData = new FormData()
          formData.append('file', new File([blob], 'voice.webm', { type: 'audio/webm' }))
          const res = await fetch('/api/upload', { method: 'POST', body: formData })
          if (!res.ok) throw new Error('Upload failed')
          const data = await res.json()
          setAudioUrl(data.url)
        } catch (e: any) {
          toast.error(e.message || 'Upload failed')
        } finally {
          setUploading(false)
        }
        stream.getTracks().forEach((t) => t.stop())
      }
      recorder.start()
      setMediaRecorder(recorder)
      setRecording(true)
      setAudioChunks(chunks)
    } catch {
      toast.error('Microphone access denied')
    }
  }

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop()
      setRecording(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Create new voice */}
      <div className="space-y-3 p-3 rounded-xl bg-muted/50 border border-border/30">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Mic className="w-4 h-4 text-primary" />
          Create a Custom Voice
        </div>
        <p className="text-xs text-muted-foreground">
          Upload or record a 10-30 second voice clip. We'll clone the voice so you can generate speech in it.
        </p>
        <div className="space-y-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Voice name (e.g. My Voice)"
          />
        </div>
        <div className="flex gap-2">
          {!audioUrl ? (
            <>
              {!recording ? (
                <Button onClick={startRecording} variant="outline" size="sm" className="flex-1">
                  <Mic className="w-4 h-4 mr-1.5" />
                  Record
                </Button>
              ) : (
                <Button onClick={stopRecording} variant="destructive" size="sm" className="flex-1">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse mr-1.5" />
                  Stop
                </Button>
              )}
              <label className="cursor-pointer flex-1">
                <Button asChild variant="outline" size="sm" className="w-full">
                  <span>
                    <Plus className="w-4 h-4 mr-1.5" />
                    Upload
                  </span>
                </Button>
                <input type="file" className="hidden" accept="audio/*" onChange={handleUpload} disabled={uploading || recording} />
              </label>
            </>
          ) : (
            <div className="flex-1 space-y-2">
              <audio controls src={audioUrl} className="w-full h-8" />
              <div className="flex gap-2">
                <Button
                  onClick={() => saveVoice.mutate()}
                  disabled={!name.trim() || saveVoice.isPending}
                  size="sm"
                  className="flex-1 gradient-primary"
                >
                  {saveVoice.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-1.5" />
                  )}
                  Save voice
                </Button>
                <Button
                  onClick={() => setAudioUrl(null)}
                  variant="outline"
                  size="sm"
                >
                  Discard
                </Button>
              </div>
            </div>
          )}
        </div>
        {uploading && (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            Uploading...
          </div>
        )}
      </div>

      {/* Existing custom voices */}
      {customVoices.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Saved Voices
          </Label>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {customVoices.map((v: any) => (
              <div
                key={v.id}
                className="flex items-center gap-3 p-2.5 rounded-xl bg-card border border-border/30 hover:border-primary/30 transition-colors group"
              >
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{v.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Created {new Date(v.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => onUseVoice(v.id)}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium"
                >
                  Use
                </button>
                <button
                  onClick={async () => {
                    const ok = await confirm({ title: `Delete "${v.name}"?`, confirmLabel: 'Delete', variant: 'danger' })
                    if (ok) deleteVoice.mutate(v.id)
                  }}
                  className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {customVoices.length === 0 && !audioUrl && (
        <div className="text-center py-6">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center mb-2">
            <Mic className="w-5 h-5 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">No custom voices yet</p>
        </div>
      )}
    </div>
  )
}

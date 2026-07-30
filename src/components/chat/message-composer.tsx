'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useChannel } from '@/hooks/useChannel'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Reply, X, Send, Image as ImageIcon, Loader2, AudioLines, Sparkles,
  Mic, Plus, Trash2, User,
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

interface MessageComposerProps {
  channelId: string
}

export function MessageComposer({ channelId }: MessageComposerProps) {
  const { send, sendTyping, replyTo, setReplyTo } = useChannel(channelId)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [ttsOpen, setTtsOpen] = useState(false)
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
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
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
        /* Cohesive glassmorphic composer bar — wraps the action buttons + input
           in a single translucent pill so they read as one unified control. */
        <div className="flex items-end gap-1.5 bg-background/60 backdrop-blur-xl rounded-[26px] p-1.5 pl-2 border border-border/60 shadow-lg ring-1 ring-black/5 transition-shadow focus-within:shadow-xl">
          {/* Upload button */}
          <label
            className="cursor-pointer w-10 h-10 flex items-center justify-center rounded-full transition-all shrink-0 text-muted-foreground hover:bg-primary/10 hover:text-primary active:scale-90"
            title="Upload image, video, or audio"
          >
            <ImageIcon className="w-[22px] h-[22px] transition-colors" />
            <input type="file" className="hidden" accept="image/*,video/*,audio/*" onChange={handleUpload} disabled={uploading} />
          </label>

          {/* TTS voice message button */}
          <button
            onClick={() => setTtsOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-full transition-all shrink-0 text-muted-foreground hover:bg-primary/10 hover:text-primary active:scale-90"
            title="Send AI voice message"
          >
            <AudioLines className="w-[22px] h-[22px] transition-colors" />
          </button>

          {/* Microphone — record a voice message (sits next to the TTS button) */}
          <button
            onClick={recorder.start}
            className="w-10 h-10 flex items-center justify-center rounded-full transition-all shrink-0 text-muted-foreground hover:bg-primary/10 hover:text-primary active:scale-90"
            title="Record a voice message"
            aria-label="Record a voice message"
          >
            <Mic className="w-[22px] h-[22px] transition-colors" />
          </button>

          {/* Text input — grows up to ~4 lines */}
          <div className="flex-1 min-w-0 bg-transparent rounded-2xl px-3 py-2 flex items-end focus-within:bg-white/5 transition-colors">
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="flex-1 resize-none min-h-[24px] max-h-[160px] bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 text-[16px] leading-relaxed shadow-none placeholder:text-muted-foreground/60"
              disabled={sending || uploading}
              rows={1}
            />
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
      await onSend(data.url, data.type || mime || 'audio/webm')
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
    setPreviewUrl(null)
    setPreviewBlob(null)
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
        // Error responses are JSON, success responses are streamed audio
        const err = await res.json().catch(() => ({ error: 'Generation failed' }))
        throw new Error(err.error || 'Generation failed')
      }
      // The route streams the WAV audio back to us — get the blob and create
      // an object URL for an instant local preview. We do NOT persist the
      // audio on the server here; when the user clicks Send, we upload the
      // blob to /api/upload and send the resulting URL as the message.
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      setPreviewBlob(blob)
      setPreviewUrl(blobUrl)
      toast.success('Voice generated — preview and send')
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate voice')
    } finally {
      setGenerating(false)
    }
  }

  const handleSend = async () => {
    if (!previewBlob || !previewUrl || sending) return
    setSending(true)
    try {
      // Upload the preview blob to /api/upload, then send the resulting
      // hosted URL as the voice message.
      const fd = new FormData()
      fd.append('file', previewBlob, 'tts.wav')
      const upRes = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!upRes.ok) {
        throw new Error('Failed to upload audio')
      }
      const { url } = await upRes.json()
      await onSend(url)
      setText('')
      if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      setPreviewBlob(null)
    } catch {
      toast.error('Failed to send voice message')
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

            {/* Preview player */}
            {previewUrl && (
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
                <Button onClick={handleSend} disabled={sending}>
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
                  onClick={() => {
                    if (confirm(`Delete "${v.name}"?`)) deleteVoice.mutate(v.id)
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

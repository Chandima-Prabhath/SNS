'use client'

import { useState, useRef, useEffect } from 'react'
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
        body: data.type.startsWith('image') ? '📷' : '📎',
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
    <div className="border-t border-white/5 bg-background/60 backdrop-blur-3xl px-3 md:px-6 py-4 pb-safe relative z-20">
      {/* Reply banner */}
      {replyTo && (
        <div className="flex items-center gap-3 text-xs bg-black/40 border border-white/10 backdrop-blur-md rounded-xl p-3 mb-3 shadow-lg">
          <Reply className="w-4 h-4 shrink-0 text-primary" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-primary">{replyTo.senderName}</div>
            <div className="text-muted-foreground truncate mt-0.5">{replyTo.body}</div>
          </div>
          <button onClick={() => setReplyTo(null)} className="p-1.5 hover:bg-white/10 rounded-full transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2.5">
        {/* Upload button */}
        <label className="cursor-pointer w-10 h-10 flex items-center justify-center hover:bg-white/5 rounded-full transition-colors shrink-0 border border-transparent hover:border-white/10">
          <ImageIcon className="w-[22px] h-[22px] text-muted-foreground hover:text-foreground transition-colors" />
          <input type="file" className="hidden" accept="image/*,video/*,audio/*" onChange={handleUpload} disabled={uploading} />
        </label>

        {/* TTS voice message button */}
        <button
          onClick={() => setTtsOpen(true)}
          className="w-10 h-10 flex items-center justify-center hover:bg-white/5 rounded-full transition-colors shrink-0 group border border-transparent hover:border-white/10"
          title="Send AI voice message"
        >
          <AudioLines className="w-[22px] h-[22px] text-muted-foreground group-hover:text-primary transition-colors" />
        </button>

        {/* Text input — grows up to ~4 lines */}
        <div className="flex-1 bg-black/20 backdrop-blur-xl rounded-[24px] px-5 py-3 flex items-end border border-white/10 shadow-inner ring-1 ring-transparent focus-within:ring-primary/30 transition-all">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="iMessage..."
            className="flex-1 resize-none min-h-[24px] max-h-[160px] bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 text-[16px] leading-relaxed shadow-none placeholder:text-muted-foreground/50"
            disabled={sending || uploading}
            rows={1}
          />
        </div>

        {/* Send button */}
        <Button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          size="icon"
          className="rounded-full h-11 w-11 shrink-0 transition-transform hover:scale-105 active:scale-95 gradient-primary shadow-glow disabled:opacity-50 disabled:shadow-none"
        >
          {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
        </Button>
      </div>

      {/* TTS Voice Message Dialog */}
      <TtsDialog
        open={ttsOpen}
        onOpenChange={setTtsOpen}
        onSend={async (url) => {
          await send({
            body: '🎙️ AI voice message',
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
  const [sending, setSending] = useState(false)
  const qc = useQueryClient()

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
        const err = await res.json()
        throw new Error(err.error || 'Generation failed')
      }
      const data = await res.json()
      setPreviewUrl(data.url)
      toast.success('Voice generated — preview and send')
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate voice')
    } finally {
      setGenerating(false)
    }
  }

  const handleSend = async () => {
    if (!previewUrl || sending) return
    setSending(true)
    try {
      await onSend(previewUrl)
      setText('')
      setPreviewUrl(null)
    } catch {
      toast.error('Failed to send voice message')
    } finally {
      setSending(false)
    }
  }

  const handleClose = (o: boolean) => {
    if (!o) {
      setText('')
      setPreviewUrl(null)
      setSelectedCustomVoiceId(null)
    }
    onOpenChange(o)
  }

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
                    <Select value={voice} onValueChange={setVoice}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alba">Alba (English, Female)</SelectItem>
                        <SelectItem value="charles">Charles (English, Male)</SelectItem>
                        <SelectItem value="jane">Jane (English, Female)</SelectItem>
                        <SelectItem value="michael">Michael (English, Male)</SelectItem>
                        <SelectItem value="vera">Vera (English, Female)</SelectItem>
                        <SelectItem value="paul">Paul (English, Male)</SelectItem>
                        <SelectItem value="estelle">Estelle (French, Female)</SelectItem>
                        <SelectItem value="giovanni">Giovanni (Italian, Male)</SelectItem>
                        <SelectItem value="juergen">Juergen (German, Male)</SelectItem>
                        <SelectItem value="lola">Lola (Spanish, Female)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {!selectedCustomVoiceId && customVoices.length === 0 && (
                <Select value={voice} onValueChange={setVoice}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alba">Alba (English, Female)</SelectItem>
                    <SelectItem value="charles">Charles (English, Male)</SelectItem>
                    <SelectItem value="jane">Jane (English, Female)</SelectItem>
                    <SelectItem value="michael">Michael (English, Male)</SelectItem>
                    <SelectItem value="vera">Vera (English, Female)</SelectItem>
                    <SelectItem value="paul">Paul (English, Male)</SelectItem>
                    <SelectItem value="estelle">Estelle (French, Female)</SelectItem>
                    <SelectItem value="giovanni">Giovanni (Italian, Male)</SelectItem>
                    <SelectItem value="juergen">Juergen (German, Male)</SelectItem>
                    <SelectItem value="lola">Lola (Spanish, Female)</SelectItem>
                  </SelectContent>
                </Select>
              )}

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
                <Button variant="outline" onClick={() => setPreviewUrl(null)} disabled={sending}>
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

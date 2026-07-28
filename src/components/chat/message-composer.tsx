'use client'

import { useState, useRef, useEffect } from 'react'
import { useChannel } from '@/hooks/useChannel'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Reply, X, Send, Image as ImageIcon, Loader2, AudioLines, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
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
    <div className="border-t bg-background/80 backdrop-blur-xl px-3 md:px-6 py-3 pb-safe">
      {/* Reply banner */}
      {replyTo && (
        <div className="flex items-center gap-2 text-xs bg-muted rounded-lg p-2 mb-2">
          <Reply className="w-3 h-3 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium">{replyTo.senderName}</div>
            <div className="text-muted-foreground truncate">{replyTo.body}</div>
          </div>
          <button onClick={() => setReplyTo(null)} className="p-1 hover:bg-accent rounded">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Upload button */}
        <label className="cursor-pointer p-2.5 hover:bg-accent rounded-full transition-colors shrink-0">
          <ImageIcon className="w-5 h-5 text-muted-foreground" />
          <input type="file" className="hidden" accept="image/*,video/*,audio/*" onChange={handleUpload} disabled={uploading} />
        </label>

        {/* TTS voice message button */}
        <button
          onClick={() => setTtsOpen(true)}
          className="p-2.5 hover:bg-accent rounded-full transition-colors shrink-0 group"
          title="Send AI voice message"
        >
          <AudioLines className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
        </button>

        {/* Text input — grows up to ~4 lines */}
        <div className="flex-1 bg-muted/70 backdrop-blur-sm rounded-2xl px-4 py-2 flex items-end border border-border/30">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            className="flex-1 resize-none min-h-[24px] max-h-[160px] bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 text-[15px] leading-snug shadow-none"
            disabled={sending || uploading}
            rows={1}
          />
        </div>

        {/* Send button */}
        <Button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          size="icon"
          className="rounded-full h-10 w-10 shrink-0 transition-transform active:scale-90 gradient-primary"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
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
 * TTS Dialog — lets the user type text, pick a voice, preview, and send.
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
  const [text, setText] = useState('')
  const [voice, setVoice] = useState('alba')
  const [generating, setGenerating] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const handleGenerate = async () => {
    if (!text.trim() || generating) return
    setGenerating(true)
    setPreviewUrl(null)
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
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
      // Reset
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
            Type a message and send it as an AI-generated voice note.
          </DialogDescription>
        </DialogHeader>

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
          </div>

          {/* Preview player */}
          {previewUrl && (
            <div className="space-y-2">
              <Label>Preview</Label>
              <audio controls src={previewUrl} className="w-full" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          {!previewUrl ? (
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
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { useState, useRef, useEffect } from 'react'
import { useChannel } from '@/hooks/useChannel'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Reply, X, Send, Image as ImageIcon, Loader2, Smile } from 'lucide-react'
import { toast } from 'sonner'

interface MessageComposerProps {
  channelId: string
}

export function MessageComposer({ channelId }: MessageComposerProps) {
  const { send, sendTyping, replyTo, setReplyTo } = useChannel(channelId)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
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
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
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
    <div className="border-t bg-background px-3 md:px-6 py-3 pb-safe">
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

        {/* Text input — grows up to ~4 lines */}
        <div className="flex-1 bg-muted rounded-2xl px-4 py-2 flex items-end">
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
          className="rounded-full h-10 w-10 shrink-0 transition-transform active:scale-90"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  )
}

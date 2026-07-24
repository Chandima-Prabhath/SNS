'use client'

import { useState, useRef, useEffect } from 'react'
import { useChannel } from '@/hooks/useChannel'
import { useAppStore } from '@/stores/useAppStore'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Reply, X, Send, Image as ImageIcon, Loader2 } from 'lucide-react'
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

  // Auto-resize
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [text])

  // Focus when reply target changes
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus()
  }, [replyTo])

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    try {
      await send({
        body: trimmed,
        replyToId: replyTo?.id || null,
      })
      setText('')
      setReplyTo(null)
      sendTyping(false)
    } catch (e: any) {
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
    if (e.target.value.length > 0) {
      sendTyping(true)
    } else {
      sendTyping(false)
    }
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
    <div className="border-t bg-card p-3 space-y-2">
      {replyTo && (
        <div className="flex items-center gap-2 text-xs bg-muted/50 rounded p-2">
          <Reply className="w-3 h-3" />
          <span className="font-medium">{replyTo.senderName}:</span>
          <span className="text-muted-foreground truncate flex-1">{replyTo.body}</span>
          <button
            onClick={() => setReplyTo(null)}
            className="hover:bg-accent rounded p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label className="cursor-pointer p-2 hover:bg-accent rounded-lg">
          <ImageIcon className="w-5 h-5 text-muted-foreground" />
          <input type="file" className="hidden" accept="image/*,video/*,audio/*" onChange={handleUpload} disabled={uploading} />
        </label>
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="flex-1 resize-none min-h-[40px] max-h-[200px] bg-background"
          disabled={sending || uploading}
          rows={1}
        />
        <Button onClick={handleSend} disabled={!text.trim() || sending} size="icon">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
      <div className="text-xs text-muted-foreground pl-1">
        Tip: use <code className="bg-muted px-1 rounded">/help</code> to see bot commands,{' '}
        <code className="bg-muted px-1 rounded">@username</code> to mention a bot.
      </div>
    </div>
  )
}

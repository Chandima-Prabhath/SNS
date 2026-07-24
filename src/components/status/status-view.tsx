'use client'

import { useState, useEffect } from 'react'
import { useStories, type StoryGroup } from '@/hooks/useStories'
import { useSession } from 'next-auth/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Eye, Trash2, X, ChevronLeft, ChevronRight, Clock, Image as ImageIcon, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function StatusView() {
  const { stories, isLoading, upload, remove } = useStories()
  const { data: session } = useSession()
  const myId = (session?.user as any)?.id

  const myStories = stories.find((s) => s.userId === myId)
  const otherStories = stories.filter((s) => s.userId !== myId)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Status</h1>
            <p className="text-sm text-muted-foreground">
              Share moments that disappear in 24 hours.
            </p>
          </div>
          <UploadStoryButton />
        </div>

        {/* My status */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
            My Status
          </h2>
          {myStories && myStories.stories.length > 0 ? (
            <div className="space-y-2">
              <StoryList stories={myStories} isMine onViewers={(storyId) => {}} onDelete={remove} />
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-lg border-2 border-dashed">
              <Avatar className="w-12 h-12">
                <AvatarFallback>
                  {(session?.user as any)?.displayName?.charAt(0) || '?'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="font-medium">No status yet</div>
                <div className="text-sm text-muted-foreground">Share what you're up to.</div>
              </div>
              <UploadStoryButton variant="default" />
            </div>
          )}
        </Card>

        {/* Other statuses */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
            Recent Updates
          </h2>
          {isLoading ? (
            <div className="text-center text-sm text-muted-foreground py-8">Loading...</div>
          ) : otherStories.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              No updates from friends right now.
            </div>
          ) : (
            <div className="space-y-2">
              {otherStories.map((s) => (
                <StoryRow key={s.userId} story={s} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function StoryRow({ story }: { story: StoryGroup }) {
  const [viewerOpen, setViewerOpen] = useState(false)
  const allUnviewed = story.stories.every((s) => !s.viewedByMe)
  const someUnviewed = story.stories.some((s) => !s.viewedByMe)

  return (
    <>
      <button
        onClick={() => setViewerOpen(true)}
        className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-accent text-left"
      >
        <div className="relative">
          <Avatar className={cn('w-12 h-12', someUnviewed && 'ring-2 ring-primary ring-offset-2')}>
            <AvatarImage src={story.user.avatarUrl || undefined} />
            <AvatarFallback>{story.user.displayName?.charAt(0) || '?'}</AvatarFallback>
          </Avatar>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{story.user.displayName}</div>
          <div className="text-sm text-muted-foreground">
            {story.stories.length} update{story.stories.length === 1 ? '' : 's'} ·{' '}
            {formatDistanceToNow(new Date(story.stories[0].createdAt), { addSuffix: true })}
          </div>
        </div>
        {someUnviewed && (
          <span className="w-2 h-2 rounded-full bg-primary" title="New" />
        )}
      </button>

      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="max-w-md p-0 overflow-hidden">
          <StoryViewer story={story} onClose={() => setViewerOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}

function StoryViewer({ story, onClose }: { story: StoryGroup; onClose: () => void }) {
  const { markViewed } = useStories()
  const [idx, setIdx] = useState(0)
  const current = story.stories[idx]

  // Mark viewed on each story change
  useEffect(() => {
    if (current && !current.viewedByMe) {
      markViewed(current.id)
    }
  }, [idx, current, markViewed])

  return (
    <div className="relative bg-black">
      <div className="aspect-[9/16] max-h-[80vh] mx-auto relative">
        {current.mediaType === 'image' && (
          <img src={current.mediaUrl} alt={current.caption || ''} className="w-full h-full object-contain" />
        )}
        {current.mediaType === 'video' && (
          <video src={current.mediaUrl} controls autoPlay className="w-full h-full object-contain" />
        )}

        {/* Top overlay */}
        <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-black/60 to-transparent">
          <div className="flex gap-1 mb-2">
            {story.stories.map((_, i) => (
              <div key={i} className="flex-1 h-0.5 bg-white/30 rounded overflow-hidden">
                <div className={cn('h-full bg-white transition-all', i === idx ? 'w-full' : i < idx ? 'w-full' : 'w-0')} />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Avatar className="w-8 h-8">
              <AvatarImage src={story.user.avatarUrl || undefined} />
              <AvatarFallback>{story.user.displayName?.charAt(0) || '?'}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-medium truncate">{story.user.displayName}</div>
              <div className="text-white/70 text-xs">{formatDistanceToNow(new Date(current.createdAt), { addSuffix: true })}</div>
            </div>
            <button onClick={onClose} className="text-white p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Caption */}
        {current.caption && (
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/60 to-transparent">
            <p className="text-white text-sm">{current.caption}</p>
          </div>
        )}

        {/* Nav arrows */}
        {idx > 0 && (
          <button
            onClick={() => setIdx(idx - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white p-1 rounded-full"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {idx < story.stories.length - 1 && (
          <button
            onClick={() => setIdx(idx + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white p-1 rounded-full"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  )
}

// We need useEffect — imported at top
function StoryList({
  stories,
  isMine,
  onDelete,
}: {
  stories: StoryGroup
  isMine?: boolean
  onViewers?: (storyId: string) => void
  onDelete: (storyId: string) => Promise<any>
}) {
  return (
    <div className="space-y-2">
      {stories.stories.map((s) => (
        <div key={s.id} className="flex items-center gap-3 p-2 rounded-lg border">
          {s.mediaType === 'image' ? (
            <img src={s.mediaUrl} alt="" className="w-12 h-12 rounded object-cover" />
          ) : (
            <video src={s.mediaUrl} className="w-12 h-12 rounded object-cover" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{s.caption || '(no caption)'}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Clock className="w-3 h-3" />
              {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}
              {isMine && (
                <>
                  · <Eye className="w-3 h-3" /> {s.viewerCount} view{s.viewerCount === 1 ? '' : 's'}
                </>
              )}
            </div>
            {isMine && s.viewers && s.viewers.length > 0 && (
              <div className="flex -space-x-1 mt-1">
                {s.viewers.slice(0, 5).map((v) => (
                  <Avatar key={v.userId} className="w-5 h-5 border border-background">
                    <AvatarImage src={v.user.avatarUrl || undefined} />
                    <AvatarFallback className="text-[8px]">
                      {v.user.displayName?.charAt(0) || '?'}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
            )}
          </div>
          {isMine && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(s.id).then(() => toast.success('Deleted'))}
            >
              <Trash2 className="w-4 h-4 text-red-500" />
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

function UploadStoryButton({ variant = 'ghost' }: { variant?: 'ghost' | 'default' }) {
  const [open, setOpen] = useState(false)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState('image')
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const { upload } = useStories()

  const reset = () => {
    setMediaUrl(null)
    setMediaType('image')
    setCaption('')
    setUploading(false)
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
      setMediaUrl(data.url)
      setMediaType(data.type.startsWith('video') ? 'video' : 'image')
    } catch (e: any) {
      toast.error(e.message || 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleSubmit = async () => {
    if (!mediaUrl) {
      toast.error('Upload an image first')
      return
    }
    try {
      await upload({ mediaUrl, mediaType, caption: caption.trim() || undefined })
      toast.success('Story posted!')
      setOpen(false)
      reset()
    } catch {
      toast.error('Failed to post')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        {variant === 'default' ? (
          <Button size="sm">
            <Plus className="w-4 h-4 mr-1" /> Add status
          </Button>
        ) : (
          <Button>
            <Plus className="w-4 h-4 mr-2" /> Add status
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Post a status</DialogTitle>
          <DialogDescription>
            Visible to your contacts. Disappears in 24 hours.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {mediaUrl ? (
            <div className="relative">
              {mediaType === 'image' ? (
                <img src={mediaUrl} alt="" className="max-h-64 mx-auto rounded-lg" />
              ) : (
                <video src={mediaUrl} controls className="max-h-64 mx-auto rounded-lg" />
              )}
              <Button
                variant="secondary"
                size="icon"
                className="absolute top-2 right-2"
                onClick={() => setMediaUrl(null)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <label className="block">
              <div className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-accent">
                {uploading ? (
                  <Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <ImageIcon className="w-8 h-8 mx-auto text-muted-foreground" />
                    <div className="text-sm mt-2">Click to upload</div>
                    <div className="text-xs text-muted-foreground">Image or video, max 8MB</div>
                  </>
                )}
              </div>
              <Input type="file" className="hidden" accept="image/*,video/*" onChange={handleUpload} />
            </label>
          )}
          <div className="space-y-2">
            <Label htmlFor="caption">Caption (optional)</Label>
            <Textarea
              id="caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="What's happening?"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!mediaUrl}>
            Post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

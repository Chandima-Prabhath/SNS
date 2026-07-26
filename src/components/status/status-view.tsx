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
import { Plus, Eye, Trash2, X, ChevronLeft, ChevronRight, Camera, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'

export function StatusView() {
  const { stories, isLoading, upload, remove } = useStories()
  const { data: session } = useSession()
  const myId = (session?.user as any)?.id

  const myStories = stories.find((s) => s.userId === myId)
  const otherStories = stories.filter((s) => s.userId !== myId)

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Status</h1>
            <p className="text-sm text-muted-foreground">Share moments that disappear in 24h</p>
          </div>
        </div>

        {/* My status */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
            My Status
          </h2>
          {myStories && myStories.stories.length > 0 ? (
            <MyStatusCard stories={myStories} onDelete={remove} />
          ) : (
            <UploadStoryCard />
          )}
        </section>

        {/* Recent updates */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
            Recent Updates
          </h2>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 p-3 animate-pulse">
                  <div className="w-14 h-14 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 bg-muted rounded" />
                    <div className="h-3 w-20 bg-muted rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : otherStories.length === 0 ? (
            <Card className="p-10 text-center border-dashed">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-primary/10 flex items-center justify-center mb-3 ring-1 ring-primary/15">
                <Camera className="w-8 h-8 text-primary" strokeWidth={1.5} />
              </div>
              <p className="font-medium text-base">No updates yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
                When your friends post a status, it'll show up here.
              </p>
            </Card>
          ) : (
            <div className="space-y-1">
              {otherStories.map((s) => (
                <StoryRow key={s.userId} story={s} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function UploadStoryCard() {
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
    <Card className="p-4 border-dashed">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Avatar className="w-14 h-14">
            <AvatarFallback>
              <Camera className="w-5 h-5 text-muted-foreground" />
            </AvatarFallback>
          </Avatar>
          <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-primary border-2 border-background flex items-center justify-center">
            <Plus className="w-3 h-3 text-primary-foreground" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[15px]">Add to status</div>
          <div className="text-xs text-muted-foreground">Share a photo or video that lasts 24h</div>
        </div>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o)
            if (!o) reset()
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">Add</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Post a status</DialogTitle>
              <DialogDescription>Disappears in 24 hours.</DialogDescription>
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
                    className="absolute top-2 right-2 h-7 w-7"
                    onClick={() => setMediaUrl(null)}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <label className="block">
                  <div className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-accent">
                    {uploading ? (
                      <div className="animate-pulse text-muted-foreground">Uploading...</div>
                    ) : (
                      <>
                        <Camera className="w-8 h-8 mx-auto text-muted-foreground" />
                        <div className="text-sm mt-2">Tap to upload</div>
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
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={!mediaUrl}>Post</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Card>
  )
}

function MyStatusCard({
  stories,
  onDelete,
}: {
  stories: StoryGroup
  onDelete: (storyId: string) => Promise<any>
}) {
  return (
    <Card className="p-3">
      <div className="space-y-2">
        {stories.stories.map((s) => (
          <div key={s.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50">
            {s.mediaType === 'image' ? (
              <img src={s.mediaUrl} alt="" className="w-12 h-12 rounded-lg object-cover" />
            ) : (
              <video src={s.mediaUrl} className="w-12 h-12 rounded-lg object-cover" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{s.caption || 'No caption'}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Clock className="w-3 h-3" />
                {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}
                {typeof s.viewerCount === 'number' && (
                  <>
                    · <Eye className="w-3 h-3" /> {s.viewerCount}
                  </>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-red-500"
              onClick={() => onDelete(s.id).then(() => toast.success('Deleted'))}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  )
}

function StoryRow({ story }: { story: StoryGroup }) {
  const [viewerOpen, setViewerOpen] = useState(false)
  const someUnviewed = story.stories.some((s) => !s.viewedByMe)

  return (
    <>
      <button
        onClick={() => setViewerOpen(true)}
        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-accent/50 transition-colors text-left"
      >
        {/* Avatar with story ring */}
        <div
          className={cn(
            'relative rounded-full p-0.5',
            someUnviewed ? 'bg-gradient-to-tr from-primary to-primary/60' : 'bg-muted'
          )}
        >
          <Avatar className="w-14 h-14 border-2 border-background">
            <AvatarImage src={story.user.avatarUrl || undefined} />
            <AvatarFallback>{story.user.displayName?.charAt(0) || '?'}</AvatarFallback>
          </Avatar>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[15px] truncate">{story.user.displayName}</div>
          <div className="text-xs text-muted-foreground">
            {story.stories.length} update{story.stories.length === 1 ? '' : 's'} ·{' '}
            {formatDistanceToNow(new Date(story.stories[0].createdAt), { addSuffix: true })}
          </div>
        </div>
      </button>

      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="max-w-md p-0 overflow-hidden border-0 bg-black">
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

  useEffect(() => {
    if (current && !current.viewedByMe) {
      markViewed(current.id)
    }
  }, [idx, current, markViewed])

  if (!current) return null

  return (
    <div className="relative bg-black">
      <div className="aspect-[9/16] max-h-[85vh] mx-auto relative">
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
                <motion.div
                  className="h-full bg-white"
                  initial={{ width: i < idx ? '100%' : '0%' }}
                  animate={{ width: i === idx ? '100%' : i < idx ? '100%' : '0%' }}
                  transition={{ duration: i === idx ? 5 : 0, ease: 'linear' }}
                  onAnimationComplete={() => {
                    if (i === idx && idx < story.stories.length - 1) {
                      setIdx(idx + 1)
                    }
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Avatar className="w-8 h-8 border border-white/30">
              <AvatarImage src={story.user.avatarUrl || undefined} />
              <AvatarFallback>{story.user.displayName?.charAt(0) || '?'}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-medium truncate">{story.user.displayName}</div>
              <div className="text-white/70 text-xs">
                {formatDistanceToNow(new Date(current.createdAt), { addSuffix: true })}
              </div>
            </div>
            <button onClick={onClose} className="text-white p-1.5 hover:bg-white/10 rounded-full">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Caption */}
        {current.caption && (
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent">
            <p className="text-white text-sm">{current.caption}</p>
          </div>
        )}

        {/* Nav arrows */}
        {idx > 0 && (
          <button
            onClick={() => setIdx(idx - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white p-1.5 rounded-full backdrop-blur-sm"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        {idx < story.stories.length - 1 && (
          <button
            onClick={() => setIdx(idx + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white p-1.5 rounded-full backdrop-blur-sm"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}

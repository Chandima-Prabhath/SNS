'use client'

import { useState, useEffect } from 'react'
import { useStories, type StoryGroup } from '@/hooks/useStories'
import { useSession } from 'next-auth/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import { compressImage, formatBytes } from '@/lib/image-compress'

export function StatusView() {
  const { stories, isLoading, upload, remove } = useStories()
  const { data: session } = useSession()
  const myId = session?.user?.id

  const myStories = stories.find((s) => s.userId === myId)
  const otherStories = stories.filter((s) => s.userId !== myId)

  return (
    <div className="h-full overflow-y-auto mesh-gradient">
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Status</h1>
          <p className="text-sm text-muted-foreground">Share moments that disappear in 24h</p>
        </div>

        {/* My status — always show upload option + existing statuses */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
            My Status
          </h2>
          <div className="space-y-3">
            <UploadStoryCard />
            {myStories && myStories.stories.length > 0 && (
              <MyStatusCard stories={myStories} onDelete={remove} />
            )}
          </div>
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
  const [audience, setAudience] = useState<'all' | 'include' | 'exclude'>('all')
  const { upload } = useStories()

  const reset = () => {
    setMediaUrl(null)
    setMediaType('image')
    setCaption('')
    setUploading(false)
    setAudience('all')
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      // Compress images client-side before uploading.
      // Mobile photos can be 5-10MB; we downscale to max 1280px and
      // re-encode as JPEG at 82% quality — typically a 5-10x size reduction.
      const isImage = file.type.startsWith('image/')
      const isVideo = file.type.startsWith('video/')
      let uploadFile: File | Blob = file
      if (isImage) {
        const originalSize = formatBytes(file.size)
        uploadFile = await compressImage(file, { maxDimension: 1280, quality: 0.82 })
        const newSize = formatBytes(uploadFile.size)
        console.log(`[status] compressed ${file.name}: ${originalSize} → ${newSize}`)
      }

      const formData = new FormData()
      formData.append('file', uploadFile)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text.slice(0, 120) || 'Upload failed')
      }
      const data = await res.json()
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
    if (!mediaUrl) return
    try {
      await upload({
        mediaUrl,
        mediaType,
        caption: caption.trim() || undefined,
        audience,
      })
      toast.success('Status posted')
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
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Post a status</DialogTitle>
              <DialogDescription>Disappears in 24 hours.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {mediaUrl ? (
                <div className="relative">
                  {mediaType === 'image' ? (
                    <img src={mediaUrl} alt="" loading="lazy" className="max-h-64 mx-auto rounded-lg" />
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
                        <div className="text-xs text-muted-foreground">Image or video · images auto-compressed</div>
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
              {/* Audience picker — who can see this story */}
              <div className="space-y-2">
                <Label>Who can see this?</Label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: 'all', label: 'Everyone', desc: 'Public' },
                    { value: 'include', label: 'Only…', desc: 'Share with selected' },
                    { value: 'exclude', label: 'All except…', desc: 'Hide from selected' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAudience(opt.value)}
                      className={cn(
                        'flex flex-col items-start gap-0.5 p-3 rounded-lg border text-left transition-colors',
                        audience === opt.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:bg-accent/50'
                      )}
                    >
                      <span className="text-xs font-medium">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground">{opt.desc}</span>
                    </button>
                  ))}
                </div>
                {audience !== 'all' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {audience === 'include'
                      ? "You'll be able to pick friends after posting — for now, the story is saved as 'include' with an empty list (only you can see it)."
                      : "You'll be able to pick friends to exclude after posting — for now, the story is visible to everyone."}
                  </p>
                )}
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
  const [viewerOpen, setViewerOpen] = useState(false)

  return (
    <>
      <Card className="p-3">
        <div className="space-y-2">
          {stories.stories.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50 cursor-pointer" onClick={() => setViewerOpen(true)}>
              {s.mediaType === 'image' ? (
              <img src={s.mediaUrl} alt="" loading="lazy" width={48} height={48} className="w-12 h-12 rounded-lg object-cover" />
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

      {/* Owner can view their own stories */}
      <AnimatePresence>
        {viewerOpen && (
          <StoryViewer story={stories} onClose={() => setViewerOpen(false)} />
        )}
      </AnimatePresence>
    </>
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
        <div
          className={cn(
            'relative rounded-full p-0.5',
            someUnviewed ? 'bg-primary' : 'bg-muted'
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

      {/* Full-screen story viewer — no Dialog wrapper (avoids duplicate close buttons) */}
      <AnimatePresence>
        {viewerOpen && (
          <StoryViewer story={story} onClose={() => setViewerOpen(false)} />
        )}
      </AnimatePresence>
    </>
  )
}

/**
 * Full-screen story viewer — renders as a fixed overlay, not inside a Dialog.
 * This avoids the duplicate close button issue (Dialog adds its own X button).
 */
function StoryViewer({ story, onClose }: { story: StoryGroup; onClose: () => void }) {
  const { markViewed } = useStories()
  const [idx, setIdx] = useState(0)
  const [progress, setProgress] = useState(0) // 0..1 for the current segment
  const current = story.stories[idx]

  useEffect(() => {
    if (current && !current.viewedByMe) {
      markViewed(current.id)
    }
  }, [idx, current, markViewed])

  // Esc-to-close — keyboard users had no way to dismiss the viewer without
  // hunting for the small X button in the corner. Listener is scoped to
  // window so it fires regardless of where focus is inside the overlay.
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, onClose])

  // Reset progress to 0 whenever the current story changes, then animate to 1
  // over the 5s duration. Using requestAnimationFrame gives a smooth fill
  // instead of the previous "instantly full" jump.
  useEffect(() => {
    if (!current) return
    setProgress(0)
    const duration = 5000
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const elapsed = now - start
      const p = Math.min(1, elapsed / duration)
      setProgress(p)
      if (p < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        // Advance to the next story or close.
        if (idx < story.stories.length - 1) {
          setIdx(idx + 1)
        } else {
          onClose()
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [idx, current, story.stories.length, onClose])

  if (!current) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Story viewer"
    >
      <div
        className="relative w-full h-full max-w-md mx-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Media */}
        <div className="flex-1 relative flex items-center justify-center">
          {current.mediaType === 'image' && (
            <img
              src={current.mediaUrl}
              alt={current.caption || ''}
              className="w-full h-full object-contain"
            />
          )}
          {current.mediaType === 'video' && (
            <video
              src={current.mediaUrl}
              controls
              autoPlay
              className="w-full h-full object-contain"
            />
          )}
        </div>

        {/* Progress bars */}
        <div className="absolute top-0 left-0 right-0 flex gap-1 p-3 pt-safe">
          {story.stories.map((_, i) => {
            // Past stories = full. Current story = animated 0..100%. Future stories = 0.
            const widthPct =
              i < idx ? 100 :
              i === idx ? progress * 100 :
              0
            return (
              <div key={i} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white"
                  style={{
                    width: `${widthPct}%`,
                    // No CSS transition — the rAF loop already animates smoothly.
                    // A transition here would fight with the rAF updates and look laggy.
                  }}
                />
              </div>
            )
          })}
        </div>

        {/* Header: avatar + name + close */}
        <div className="absolute top-6 left-0 right-0 flex items-center gap-2 p-3">
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
          {/* Single close button — no Dialog duplicate */}
          <button
            onClick={onClose}
            className="text-white p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Caption */}
        {current.caption && (
          <div className="absolute bottom-0 left-0 right-0 p-4 pb-safe bg-gradient-to-t from-black/70 to-transparent">
            <p className="text-white text-sm">{current.caption}</p>
          </div>
        )}

        {/* Nav arrows — tap zones instead of buttons for cleaner UI */}
        {idx > 0 && (
          <button
            onClick={() => setIdx(idx - 1)}
            className="absolute left-0 top-0 bottom-0 w-1/3 flex items-center justify-start"
          >
            <div className="bg-black/30 rounded-full p-1.5 ml-2 backdrop-blur-sm">
              <ChevronLeft className="w-5 h-5 text-white" />
            </div>
          </button>
        )}
        {idx < story.stories.length - 1 && (
          <button
            onClick={() => setIdx(idx + 1)}
            className="absolute right-0 top-0 bottom-0 w-1/3 flex items-center justify-end"
          >
            <div className="bg-black/30 rounded-full p-1.5 mr-2 backdrop-blur-sm">
              <ChevronRight className="w-5 h-5 text-white" />
            </div>
          </button>
        )}
      </div>
    </motion.div>
  )
}

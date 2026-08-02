'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/stores/useAppStore'
import { usePresence } from '@/hooks/usePresence'
import { useCall } from '@/hooks/useCall'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Calendar, Mail, MessageSquare, Clock, Crown, Shield, Phone, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/**
 * UserProfileSheet — global right-side sheet that opens when the user clicks
 * any avatar in chat / member lists. Shows the user's profile (avatar, name,
 * bio, role, status, last seen, message count) and quick actions (DM, call).
 *
 * Open state is controlled by useAppStore.profileUserId — set it to a userId
 * to open the sheet, set to null to close.
 */
export function UserProfileSheet() {
  const profileUserId = useAppStore((s) => s.profileUserId)
  const setProfileUserId = useAppStore((s) => s.setProfileUserId)
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)
  const setView = useAppStore((s) => s.setView)
  const presence = usePresence()
  const qc = useQueryClient()
  const { startCall } = useCall()

  const { data, isLoading } = useQuery({
    queryKey: ['user-profile', profileUserId],
    queryFn: async () => {
      if (!profileUserId) return null
      const res = await fetch(`/api/users?id=${profileUserId}`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    enabled: !!profileUserId,
  })

  const user = data?.user
  const status = user ? (presence[user.id]?.status || user.status || 'offline') : 'offline'

  // Start (or open) a DM with the target user. PUT /api/groups with
  // targetUserId creates a DM group if one doesn't exist, or returns the
  // existing one. Then we switch to the chats view + activate the channel.
  const startDm = useMutation({
    mutationFn: async (targetUserId: string) => {
      const res = await fetch('/api/groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId }),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['channels'] })
      setProfileUserId(null)
      setActiveChannel(data.channel.id)
      setView('chats')
      toast.success('DM opened')
    },
    onError: () => toast.error('Could not open DM'),
  })

  const handleCall = async (video: boolean) => {
    if (!user) return
    setProfileUserId(null)
    setView('chats')
    // Open the DM first so the call has a channel to attach to
    try {
      const dmRes = await fetch('/api/groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: user.id }),
      })
      if (dmRes.ok) {
        const dmData = await dmRes.json()
        qc.invalidateQueries({ queryKey: ['channels'] })
        setActiveChannel(dmData.channel.id)
        // Generate a call ID and start the call on that DM group — rings
        // the partner directly.
        const callId = crypto.randomUUID()
        await startCall({
          callId,
          dmGroupId: dmData.channel.groupId,
          enableVideo: video,
        })
        setView('voice')
      }
    } catch (e: any) {
      toast.error('Could not start call')
    }
  }

  return (
    <Sheet open={!!profileUserId} onOpenChange={(o) => !o && setProfileUserId(null)}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>User profile</SheetTitle>
        </SheetHeader>

        {isLoading || !user ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Loading…
          </div>
        ) : (
          <div className="flex flex-col h-full overflow-y-auto">
            {/* Hero with avatar + name */}
            <div className="relative p-6 pb-5 flex flex-col items-center text-center mesh-gradient">
              <div className="relative mb-3">
                <Avatar className="w-24 h-24 ring-4 ring-background/50 shadow-xl">
                  {user.avatarUrl ? <AvatarImage src={user.avatarUrl} /> : null}
                  <AvatarFallback className="text-3xl font-bold">
                    {user.displayName?.charAt(0) || '?'}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    'absolute bottom-1 right-1 w-4 h-4 rounded-full border-4 border-background',
                    status === 'online' && 'bg-status-online',
                    status === 'idle' && 'bg-status-idle',
                    status === 'dnd' && 'bg-status-dnd',
                    status === 'offline' && 'bg-status-offline'
                  )}
                />
              </div>
              <h2 className="text-xl font-semibold flex items-center gap-1.5">
                {user.displayName}
                {user.role === 'owner' && <Crown className="w-4 h-4 text-primary" />}
                {user.role === 'admin' && <Shield className="w-4 h-4 text-primary" />}
              </h2>
              <p className="text-sm text-muted-foreground">@{user.username}</p>
              {user.bio && (
                <p className="text-sm text-foreground/80 mt-3 max-w-xs">{user.bio}</p>
              )}
              <div className="flex items-center gap-2 mt-3">
                <Badge
                  variant="secondary"
                  className={cn(
                    'text-xs',
                    status === 'online' && 'bg-status-online/15 text-status-online',
                    status === 'idle' && 'bg-status-idle/15 text-status-idle',
                    status === 'dnd' && 'bg-status-dnd/15 text-status-dnd',
                    status === 'offline' && 'bg-status-offline/15 text-status-offline'
                  )}
                >
                  {status === 'online' ? 'Online' :
                   status === 'idle' ? 'Idle' :
                   status === 'dnd' ? 'Do Not Disturb' :
                   'Offline'}
                </Badge>
                {user.role !== 'member' && (
                  <Badge className="text-xs uppercase">{user.role}</Badge>
                )}
              </div>
            </div>

            {/* Quick actions */}
            <div className="p-4 border-b border-white/5">
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={startDm.isPending}
                  onClick={() => user && startDm.mutate(user.id)}
                >
                  {startDm.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <MessageSquare className="w-4 h-4 mr-2" />
                  )}
                  Message
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCall(false)}
                >
                  <Phone className="w-4 h-4 mr-2" />
                  Call
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCall(true)}
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Video
                </Button>
              </div>
            </div>

            {/* Details */}
            <div className="p-4 space-y-3 flex-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Details
              </h3>
              <DetailRow
                icon={Mail}
                label="Email"
                value={user.email}
              />
              <DetailRow
                icon={Clock}
                label="Last seen"
                value={
                  user.lastSeenVisible === false
                    ? 'Hidden'
                    : user.lastSeenAt
                      ? formatRelative(new Date(user.lastSeenAt).toISOString())
                      : 'Never'
                }
              />
              <DetailRow
                icon={Calendar}
                label="Joined"
                value={user.createdAt ? new Date(user.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric', month: 'long', day: 'numeric',
                }) : 'Unknown'}
              />
              {user._count?.messages !== undefined && (
                <DetailRow
                  icon={MessageSquare}
                  label="Messages"
                  value={String(user._count.messages)}
                />
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.02]">
      <div className="w-8 h-8 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-medium truncate">{value}</div>
      </div>
    </div>
  )
}

function formatRelative(dateStr: string): string {
  const d = new Date(dateStr)
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return d.toLocaleDateString()
}

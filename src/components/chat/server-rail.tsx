'use client'

import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/stores/useAppStore'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, MessageCircle, Users, Compass } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { useState } from 'react'

/**
 * Discord-style server rail — a narrow vertical bar on the far left showing:
 *   - DMs (MessageCircle icon, always at top)
 *   - A divider
 *   - Each group the user is a member of (group icon or first letter)
 *   - A "+" button to create/join a group
 *
 * On mobile this is hidden by default and revealed via the sidebar toggle.
 * On desktop it's always visible.
 */
export function ServerRail() {
  const selectedGroupId = useAppStore((s) => s.selectedGroupId)
  const setSelectedGroupId = useAppStore((s) => s.setSelectedGroupId)

  const { data: groups } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      const data = await res.json()
      return data.groups as any[]
    },
  })

  // Non-DM groups only
  const serverGroups = groups?.filter((g) => !g.isDm) || []

  return (
    <div className="hidden md:flex w-16 lg:w-[72px] shrink-0 flex-col items-center gap-2 py-3 bg-sidebar border-r border-sidebar-border overflow-y-auto no-scrollbar">
      {/* DMs button */}
      <RailButton
        active={selectedGroupId === 'dm'}
        onClick={() => setSelectedGroupId('dm')}
        label="Direct Messages"
      >
        <MessageCircle className="w-5 h-5" />
      </RailButton>

      {/* Divider */}
      <div className="w-8 h-px bg-sidebar-border my-1" />

      {/* Server list */}
      {serverGroups.map((g) => (
        <RailButton
          key={g.id}
          active={selectedGroupId === g.id}
          onClick={() => setSelectedGroupId(g.id)}
          label={g.name}
        >
          {g.iconUrl ? (
            <img src={g.iconUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="font-semibold text-sm">
              {g.name.charAt(0).toUpperCase()}
            </span>
          )}
        </RailButton>
      ))}

      {/* Create / join group */}
      <CreateOrJoinGroupButton />

      {/* Compass — discover public groups (future) */}
      <RailButton
        onClick={() => toast.info('Group discovery coming soon')}
        label="Discover"
      >
        <Compass className="w-5 h-5" />
      </RailButton>
    </div>
  )
}

/**
 * A single square icon button in the rail. Active state shows a primary
 * background; inactive shows a sidebar-accent background. Hover shows a
 * tooltip with the label.
 */
function RailButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="group relative">
      {/* Active indicator — vertical bar on the left */}
      <div
        className={cn(
          'absolute -left-3 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-foreground transition-all',
          active ? 'h-7' : 'h-0 group-hover:h-3'
        )}
      />
      <button
        onClick={onClick}
        title={label}
        className={cn(
          'w-12 h-12 lg:w-[52px] lg:h-[52px] rounded-2xl flex items-center justify-center transition-all overflow-hidden',
          'hover:rounded-xl active:scale-95',
          active
            ? 'bg-primary text-primary-foreground'
            : 'bg-sidebar-accent text-sidebar-accent-foreground hover:bg-primary hover:text-primary-foreground'
        )}
      >
        {children}
      </button>
    </div>
  )
}

function CreateOrJoinGroupButton() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [code, setCode] = useState('')
  const qc = useQueryClient()
  const setSelectedGroupId = useAppStore((s) => s.setSelectedGroupId)

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, channels: ['general'] }),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Group created')
      setSelectedGroupId(data.group.id)
      setOpen(false)
      setName('')
      setDescription('')
    },
    onError: () => toast.error('Failed to create group'),
  })

  const join = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/groups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: code.trim() }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'failed')
      }
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Joined group')
      setSelectedGroupId(data.group.id)
      setOpen(false)
      setCode('')
    },
    onError: (e: any) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          title="Create or join a group"
          className="w-12 h-12 lg:w-[52px] lg:h-[52px] rounded-2xl flex items-center justify-center transition-all hover:rounded-xl active:scale-95 bg-sidebar-accent text-emerald-400 hover:bg-emerald-500 hover:text-white"
        >
          <Plus className="w-5 h-5" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create or Join a Group</DialogTitle>
          <DialogDescription>Start a new group or join one with an invite code.</DialogDescription>
        </DialogHeader>

        {/* Mode switcher */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setMode('create')}
            className={cn(
              'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors',
              mode === 'create' ? 'bg-background text-foreground' : 'text-muted-foreground'
            )}
          >
            Create
          </button>
          <button
            onClick={() => setMode('join')}
            className={cn(
              'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors',
              mode === 'join' ? 'bg-background text-foreground' : 'text-muted-foreground'
            )}
          >
            Join
          </button>
        </div>

        {mode === 'create' ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="rail-group-name">Group name</Label>
              <Input
                id="rail-group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Weekend Crew"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rail-group-desc">Description (optional)</Label>
              <Input
                id="rail-group-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's this group about?"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              A "general" text channel will be created automatically. You can add more channels later from the group settings.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="rail-join-code">Invite code</Label>
            <Input
              id="rail-join-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste invite code..."
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          {mode === 'create' ? (
            <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
              {create.isPending ? 'Creating...' : 'Create'}
            </Button>
          ) : (
            <Button onClick={() => join.mutate()} disabled={!code.trim() || join.isPending}>
              {join.isPending ? 'Joining...' : 'Join'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

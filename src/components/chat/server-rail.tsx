'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore, type ViewKey } from '@/stores/useAppStore'
import { useUnreadCounts } from '@/hooks/useUnreadCounts'
import { useCall } from '@/hooks/useCall'
import { useSession } from 'next-auth/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Plus, MessageCircle, Compass, Phone, Settings, Circle, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface NavItem {
  key: ViewKey
  label: string
  icon: typeof MessageCircle
  /** If true, clicking opens the Entertainment drawer instead of switching the view */
  opensDrawer?: boolean
}

// Music + Cinema are merged into the Entertainment item, which opens a drawer
const NAV_ITEMS: NavItem[] = [
  { key: 'entertainment', label: 'Entertainment', icon: Sparkles, opensDrawer: true },
  { key: 'status', label: 'Status', icon: Circle },
  { key: 'voice', label: 'Calls', icon: Phone },
  { key: 'settings', label: 'Settings', icon: Settings },
]

/** Returns true if the Entertainment rail button should be highlighted */
function isEntertainmentActive(view: ViewKey): boolean {
  return view === 'music' || view === 'cinema' || view === 'entertainment'
}

/**
 * Discord-style server rail — the single primary navigation sidebar.
 *
 * Layout (top to bottom):
 *   - DMs button (always at top)
 *   - Divider
 *   - Server (group) icons
 *   - Create/join group button
 *   - Spacer (flex-1)
 *   - Bottom nav: Status, Calls, Settings
 *   - User avatar (click → settings)
 *
 * On desktop: always visible as a 72px column.
 * On mobile: hidden by default, revealed via a slide-out drawer triggered
 * by a button in the chat list header.
 */
export function ServerRail() {
  return (
    <>
      <DesktopServerRail />
      <MobileServerRail />
    </>
  )
}

function DesktopServerRail() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const setEntertainmentDrawerOpen = useAppStore((s) => s.setEntertainmentDrawerOpen)
  const selectedGroupId = useAppStore((s) => s.selectedGroupId)
  const setSelectedGroupId = useAppStore((s) => s.setSelectedGroupId)
  const { data: unreadData } = useUnreadCounts()
  const { status: callStatus } = useCall()
  const { data: session } = useSession()
  const totalUnread = unreadData?.total || 0

  const { data: groups } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      const data = await res.json()
      return data.groups as any[]
    },
  })

  const serverGroups = groups?.filter((g) => !g.isDm) || []

  return (
    <div className="hidden md:flex w-[72px] lg:w-20 shrink-0 flex-col items-center gap-1.5 py-3 bg-sidebar border-r border-sidebar-border/50 relative">
      {/* Subtle top gradient for cinematic depth */}
      <div
        className="absolute inset-x-0 top-0 h-24 pointer-events-none opacity-60"
        style={{ background: 'radial-gradient(ellipse 100% 100% at 50% 0%, oklch(0.64 0.22 264 / 0.06), transparent 70%)' }}
      />

      {/* Top section: DMs + servers */}
      <div className="relative flex flex-col items-center gap-1.5">
        {/* DMs button */}
        <RailButton
          active={view === 'chats' && selectedGroupId === 'dm'}
          onClick={() => { setView('chats'); setSelectedGroupId('dm') }}
          label="Direct Messages"
        >
          <MessageCircle className="w-5 h-5" strokeWidth={2.2} />
          {totalUnread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </RailButton>

        {/* Divider */}
        <div className="w-8 h-px bg-sidebar-border/60 my-0.5" />

        {/* Server list */}
        {serverGroups.map((g) => (
          <RailButton
            key={g.id}
            active={view === 'chats' && selectedGroupId === g.id}
            onClick={() => { setView('chats'); setSelectedGroupId(g.id) }}
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
      </div>

      {/* Spacer pushes bottom nav down */}
      <div className="flex-1" />

      {/* Bottom nav: Entertainment, Status, Calls, Settings */}
      <div className="relative flex flex-col items-center gap-1.5">
        <div className="w-8 h-px bg-sidebar-border/60 mb-0.5" />
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = item.opensDrawer ? isEntertainmentActive(view) : view === item.key
          const showCallIndicator = item.key === 'voice' && callStatus !== 'idle'
          return (
            <RailButton
              key={item.key}
              active={active}
              onClick={() => item.opensDrawer ? setEntertainmentDrawerOpen(true) : setView(item.key)}
              label={item.label}
            >
              <Icon className="w-5 h-5" strokeWidth={active ? 2.4 : 2} fill={active && item.key === 'status' ? 'currentColor' : 'none'} />
              {showCallIndicator && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse border-2 border-sidebar" />
              )}
            </RailButton>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Mobile server rail — a slide-out drawer that's triggered by the
 * `serverRailOpen` state in the app store. Shows the same content as the
 * desktop rail but in a horizontal-friendly vertical layout.
 */
function MobileServerRail() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const selectedGroupId = useAppStore((s) => s.selectedGroupId)
  const setSelectedGroupId = useAppStore((s) => s.setSelectedGroupId)
  const open = useAppStore((s) => s.serverRailOpen)
  const setOpen = useAppStore((s) => s.setServerRailOpen)
  const { data: unreadData } = useUnreadCounts()
  const totalUnread = unreadData?.total || 0

  const { data: groups } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      const data = await res.json()
      return data.groups as any[]
    },
  })

  const serverGroups = groups?.filter((g) => !g.isDm) || []

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — onClick closes the drawer. We use pointer-events-none
              during exit so it doesn't intercept clicks from dialogs that
              opened on top. */}
          <motion.div
            initial={{ opacity: 0, pointerEvents: 'auto' as const }}
            animate={{ opacity: 1, pointerEvents: 'auto' as const }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            onClick={() => setOpen(false)}
            className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            style={{ pointerEvents: open ? 'auto' : 'none' }}
          />
          {/* Drawer */}
          <motion.div
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            transition={{ type: 'spring', stiffness: 350, damping: 35 }}
            className="md:hidden fixed left-0 top-0 bottom-16 z-50 w-20 flex flex-col items-center gap-1.5 py-4 bg-sidebar border-r border-sidebar-border/50 glass-dark"
            style={{ pointerEvents: open ? 'auto' : 'none' }}
          >
            {/* Top section: DMs + servers */}
            <div className="flex flex-col items-center gap-1.5">
              {/* DMs */}
              <RailButton
                active={view === 'chats' && selectedGroupId === 'dm'}
                onClick={() => { setView('chats'); setSelectedGroupId('dm'); setOpen(false) }}
                label="Direct Messages"
              >
                <MessageCircle className="w-5 h-5" strokeWidth={2.2} />
                {totalUnread > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                    {totalUnread > 99 ? '99+' : totalUnread}
                  </span>
                )}
              </RailButton>

              <div className="w-8 h-px bg-sidebar-border/60 my-0.5" />

              {serverGroups.map((g) => (
                <RailButton
                  key={g.id}
                  active={view === 'chats' && selectedGroupId === g.id}
                  onClick={() => { setView('chats'); setSelectedGroupId(g.id); setOpen(false) }}
                  label={g.name}
                >
                  {g.iconUrl ? (
                    <img src={g.iconUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="font-semibold text-sm">{g.name.charAt(0).toUpperCase()}</span>
                  )}
                </RailButton>
              ))}

              <CreateOrJoinGroupButton
                onCreated={() => setOpen(false)}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
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
      <div
        className={cn(
          'absolute -left-3 top-1/2 -translate-y-1/2 w-1.5 rounded-r-full bg-primary shadow-glow transition-all duration-300',
          active ? 'h-8 opacity-100' : 'h-0 opacity-0 group-hover:h-4 group-hover:opacity-50'
        )}
      />
      <button
        onClick={onClick}
        title={label}
        className={cn(
          'relative w-12 h-12 lg:w-[52px] lg:h-[52px] rounded-2xl flex items-center justify-center transition-all duration-300',
          'hover:rounded-xl active:scale-95',
          active
            ? 'bg-primary/20 text-primary ring-1 ring-primary/50 shadow-glow backdrop-blur-md'
            : 'bg-white/[0.03] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground ring-1 ring-white/5 backdrop-blur-sm'
        )}
      >
        {children}
      </button>
    </div>
  )
}

function CreateOrJoinGroupButton({ onCreated, onOpen }: { onCreated?: () => void; onOpen?: () => void } = {}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [code, setCode] = useState('')
  const qc = useQueryClient()
  const setSelectedGroupId = useAppStore((s) => s.setSelectedGroupId)
  const setView = useAppStore((s) => s.setView)

  // When the dialog opens, call onOpen (closes the mobile drawer so the
  // dialog is accessible without the drawer's backdrop blocking it)
  const handleOpenChange = (o: boolean) => {
    setOpen(o)
    if (o) onOpen?.()
  }

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
      setView('chats')
      setOpen(false)
      setName('')
      setDescription('')
      onCreated?.()
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
      setView('chats')
      setOpen(false)
      setCode('')
      onCreated?.()
    },
    onError: (e: any) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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

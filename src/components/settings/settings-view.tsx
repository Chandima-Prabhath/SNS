'use client'

import { useState, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Loader2,
  Save,
  LogOut,
  ChevronRight,
  Bot,
  Shield,
  User,
  Server,
  Plus,
  Trash2,
  Check,
  X,
  Terminal,
  Hash,
  Sparkles,
} from 'lucide-react'
import { signOut } from 'next-auth/react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { generateAvatarCandidates, AVATAR_STYLES } from '@/lib/avatar'
import { SpotlightCard, GlassSurface, GradientText, ShinyText } from '@/components/reactbits'
// BotBuilderEditor is now loaded via the standalone /bot-builder/[id] route
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type SettingsSection = 'profile' | 'privacy' | 'bots' | 'admin' | 'system'

export function SettingsView() {
  const { data: session } = useSession()
  const [section, setSection] = useState<SettingsSection>('profile')

  const role = (session?.user as any)?.role
  const isAdmin = role === 'admin' || role === 'owner'

  const sections: { key: SettingsSection; label: string; icon: typeof User; adminOnly?: boolean }[] = [
    { key: 'profile', label: 'Profile', icon: User },
    { key: 'privacy', label: 'Privacy', icon: Shield },
    { key: 'bots', label: 'Bots', icon: Bot },
    ...(isAdmin ? [{ key: 'admin' as SettingsSection, label: 'Admin', icon: Shield, adminOnly: true as const }] : []),
    { key: 'system', label: 'System', icon: Server },
  ]

  return (
    <div className="h-full overflow-hidden flex flex-col mesh-gradient">
      <div className="max-w-4xl w-full mx-auto p-4 md:p-6 flex-1 flex flex-col min-h-0 lg:pb-0 pb-20">
        {/* Header with gradient text */}
        <div className="mb-5 shrink-0">
          <h1 className="text-3xl font-bold tracking-tight">
            <GradientText>Settings</GradientText>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your profile, privacy, and more</p>
        </div>

        {/* Section navigation — glassmorphic pill bar */}
        <GlassSurface className="mb-4 shrink-0" blur={16} opacity={0.05}>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar p-1.5">
            {sections.map((s) => {
              const Icon = s.icon
              const active = section === s.key
              return (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap shrink-0',
                    active
                      ? 'gradient-primary text-primary-foreground shadow-glow'
                      : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span>{s.label}</span>
                </button>
              )
            })}
          </div>
        </GlassSurface>

        {/* Section content — scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto pb-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              {section === 'profile' && <ProfileSection />}
              {section === 'privacy' && <PrivacySection />}
              {section === 'bots' && <BotsSection />}
              {section === 'admin' && isAdmin && <AdminSection />}
              {section === 'system' && <SystemSection />}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Sign out */}
        <div className="pt-6 shrink-0 flex justify-center">
          <Button
            variant="outline"
            onClick={async () => {
              // Clear the cached session so offline mode doesn't let them back in
              try { localStorage.removeItem('adoo-session-cache') } catch {}
              await signOut({ callbackUrl: '/', redirect: false })
              window.location.replace('/')
            }}
            className="w-full sm:w-auto h-12 px-8 rounded-xl text-red-500 border-red-500/20 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/30 transition-all bg-red-500/5 shadow-[0_0_15px_rgba(239,68,68,0.1)]"
          >
            <LogOut className="w-4 h-4 mr-2" /> Sign out securely
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Profile ──────────────────────────────────────────────────────────────

function ProfileSection() {
  const { data: session } = useSession()
  const qc = useQueryClient()

  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me')
      const data = await res.json()
      return data.user
    },
  })

  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [customStatus, setCustomStatus] = useState('')
  const [uploading, setUploading] = useState(false)

  // Sync from server once
  useState(() => {
    if (me) {
      setDisplayName(me.displayName || '')
      setBio(me.bio || '')
      setAvatarUrl(me.avatarUrl || '')
      setCustomStatus(me.customStatus || '')
    }
  })

  // Also sync on data change
  if (me && displayName === '' && me.displayName) {
    setDisplayName(me.displayName)
    setBio(me.bio || '')
    setAvatarUrl(me.avatarUrl || '')
    setCustomStatus(me.customStatus || '')
  }

  const update = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(`/api/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      toast.success('Saved')
    },
    onError: () => toast.error('Failed to save'),
  })

  const handleSave = () => {
    update.mutate({ displayName, bio, avatarUrl, customStatus })
  }

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      setAvatarUrl(data.url)
      toast.success('Avatar uploaded — click Save to apply')
    } catch (e: any) {
      toast.error(e.message || 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>

  return (
    <div className="space-y-6">
      <GlassSurface blur={16} opacity={0.03} className="p-6">
        <div className="flex flex-col md:flex-row gap-8 items-start md:items-center">
          <AvatarPicker
            currentAvatarUrl={avatarUrl}
            userId={me?.id || 'seed'}
            onPick={(url) => { setAvatarUrl(url); toast.success('Avatar selected — click Save to apply') }}
            onUpload={handleAvatar}
            uploading={uploading}
          />
          <div className="flex-1 space-y-1">
            <h2 className="text-xl font-semibold"><ShinyText shimmerDuration={3}>{displayName || 'Your Profile'}</ShinyText></h2>
            <p className="text-sm text-muted-foreground">Manage your public persona</p>
          </div>
        </div>
      </GlassSurface>

      <GlassSurface blur={16} opacity={0.03} className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="displayName" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Display name</Label>
            <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="h-12 bg-black/20 border-white/10 rounded-xl px-4 focus-visible:ring-primary/50 transition-all" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Username</Label>
            <Input id="username" value={me?.username || ''} disabled className="h-12 bg-black/20 border-white/5 rounded-xl px-4 opacity-70 cursor-not-allowed" />
            <p className="text-[10px] text-muted-foreground pl-1">Username cannot be changed.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="customStatus" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Custom status</Label>
          <Input
            id="customStatus"
            value={customStatus}
            onChange={(e) => setCustomStatus(e.target.value)}
            placeholder="Listening to lofi beats"
            maxLength={80}
            className="h-12 bg-black/20 border-white/10 rounded-xl px-4 focus-visible:ring-primary/50 transition-all"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bio" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bio</Label>
          <Textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Tell your friends a bit about yourself."
            rows={3}
            className="bg-black/20 border-white/10 rounded-xl p-4 focus-visible:ring-primary/50 transition-all resize-none"
          />
        </div>

        <div className="pt-2 flex justify-end">
          <Button onClick={handleSave} disabled={update.isPending} className="h-11 px-6 rounded-xl gradient-primary shadow-glow hover:scale-105 active:scale-95 transition-all font-semibold">
            {update.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save changes
          </Button>
        </div>
      </GlassSurface>
    </div>
  )
}

// ─── Privacy ──────────────────────────────────────────────────────────────

function PrivacySection() {
  const qc = useQueryClient()
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me')
      const data = await res.json()
      return data.user
    },
  })

  const [lastSeenVisible, setLastSeenVisible] = useState(true)
  const [readReceipts, setReadReceipts] = useState(true)
  const [typingIndicators, setTypingIndicators] = useState(true)

  if (me && lastSeenVisible && !me.lastSeenVisible === false) {
    // initial sync — only run once
  }
  useState(() => {
    if (me) {
      setLastSeenVisible(me.lastSeenVisible ?? true)
      setReadReceipts(me.readReceiptsEnabled ?? true)
      setTypingIndicators(me.typingIndicatorsEnabled ?? true)
    }
  })

  const update = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(`/api/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      toast.success('Saved')
    },
  })

  const handleToggle = (key: 'lastSeenVisible' | 'readReceiptsEnabled' | 'typingIndicatorsEnabled', value: boolean) => {
    if (key === 'lastSeenVisible') setLastSeenVisible(value)
    if (key === 'readReceiptsEnabled') setReadReceipts(value)
    if (key === 'typingIndicatorsEnabled') setTypingIndicators(value)
    update.mutate({ [key]: value })
  }

  return (
    <GlassSurface blur={16} opacity={0.03} className="overflow-hidden">
      <div className="divide-y divide-white/5">
        <PrivacyRow
          title="Last seen visible"
          desc="Show when you were last active"
          checked={lastSeenVisible}
          onChange={(v) => handleToggle('lastSeenVisible', v)}
        />
        <PrivacyRow
          title="Read receipts"
          desc="Let others know when you've read their messages"
          checked={readReceipts}
          onChange={(v) => handleToggle('readReceiptsEnabled', v)}
        />
        <PrivacyRow
          title="Typing indicators"
          desc="Show others when you're typing"
          checked={typingIndicators}
          onChange={(v) => handleToggle('typingIndicatorsEnabled', v)}
        />
      </div>
    </GlassSurface>
  )
}

function PrivacyRow({ title, desc, checked, onChange }: { title: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors">
      <div className="flex-1 min-w-0 pr-6">
        <div className="font-semibold text-[15px]">{title}</div>
        <div className="text-sm text-muted-foreground mt-0.5">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="data-[state=checked]:bg-primary" />
    </div>
  )
}

// ─── Bots ─────────────────────────────────────────────────────────────────

function BotsSection() {
  return (
    <div className="space-y-4">
      <BotsList onEditBot={(bot) => {
        // Open the bot builder in a new standalone tab — gives the canvas
        // full screen space and makes it usable on mobile.
        window.open(`/bot-builder/${bot.id}`, '_blank')
      }} />
      <BotModules />
    </div>
  )
}

function BotsList({ onEditBot }: { onEditBot: (bot: any) => void }) {
  const { bots, isLoading, create, update, remove } = useBots()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [description, setDescription] = useState('')

  const handleCreate = async () => {
    try {
      await create({ name, username, description, module: 'visual' })
      toast.success('Bot created! Edit it to design your flow.')
      setCreateOpen(false)
      setName('')
      setUsername('')
      setDescription('')
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-sm">My Bots ({bots.length})</h2>
        <Button size="sm" onClick={() => setCreateOpen(!createOpen)}>
          <Plus className="w-4 h-4 mr-1" /> New Bot
        </Button>
      </div>

      {createOpen && (
        <div className="space-y-3 mb-4 p-3 rounded-xl border bg-muted/30">
          <div className="space-y-2">
            <Label>Bot name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Poll Bot" />
          </div>
          <div className="space-y-2">
            <Label>Username (lowercase, no spaces)</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="pollbot" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Runs polls in any channel" />
          </div>
          <p className="text-xs text-muted-foreground">
            Bots are created with the visual flow editor. After creating, click "Edit Flow" to design your bot's behavior.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={!name.trim() || !username.trim()}>Create</Button>
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-6 text-sm text-muted-foreground">Loading...</div>
      ) : bots.length === 0 ? (
        <div className="text-center py-10">
          <div className="w-16 h-16 mx-auto rounded-3xl bg-primary/10 flex items-center justify-center mb-3 ring-1 ring-primary/15">
            <Bot className="w-8 h-8 text-primary" strokeWidth={1.5} />
          </div>
          <p className="font-medium text-base">No bots yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
            Create a bot and design its behavior visually with the flow editor.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {bots.map((bot: any) => (
            <div key={bot.id} className="p-3 rounded-lg border space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {bot.name} <span className="text-xs text-muted-foreground">@{bot.username}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {bot.module} · {bot.enabled ? 'enabled' : 'disabled'}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => onEditBot(bot)}>
                  Edit Flow
                </Button>
                <Button variant="ghost" size="sm" onClick={() => update({ id: bot.id, data: { enabled: !bot.enabled } })}>
                  {bot.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500"
                  onClick={() => { if (confirm(`Delete bot @${bot.username}?`)) { remove(bot.id).then(() => toast.success('Deleted')) } }}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              {/* Add to channel */}
              <AddBotToChannel botId={bot.id} />
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function BotModules() {
  const { modules } = useBots()
  return (
    <Card className="p-4">
      <h2 className="font-semibold text-sm mb-3">Available Modules ({modules.length})</h2>
      <div className="space-y-2">
        {modules.map((m) => (
          <div key={m.name} className="border rounded-lg p-2.5">
            <div className="flex items-baseline gap-2 mb-1">
              <code className="text-sm font-mono font-medium">{m.name}</code>
              <span className="text-xs text-muted-foreground">{m.description}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {m.commands.map((c: any) => (
                <Badge key={c.name} variant="secondary" className="font-mono text-xs">
                  /{c.name}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 flex gap-2">
        <Terminal className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium mb-0.5">Want your own bot?</p>
          <p>
            Drop a file in <code>src/lib/bot/bots/</code>, export a <code>BotModule</code>, register in{' '}
            <code>src/lib/bot/index.ts</code>.
          </p>
        </div>
      </div>
    </Card>
  )
}

// Local hook (since we removed the dedicated Bots view, we need useBots here)
import { useBots } from '@/hooks/useBots'

// ─── Admin ────────────────────────────────────────────────────────────────

function AdminSection() {
  const [tab, setTab] = useState<'users' | 'groups' | 'bots'>('users')
  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {(['users', 'groups', 'bots'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors capitalize',
              tab === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'users' && <AdminUsers />}
      {tab === 'groups' && <AdminGroups />}
      {tab === 'bots' && <AdminBots />}
    </div>
  )
}

function AdminUsers() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await fetch('/api/admin/users')
      if (!res.ok) throw new Error('forbidden')
      return res.json()
    },
  })

  const updateRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('Role updated')
    },
    onError: () => toast.error('Failed'),
  })

  if (isLoading) return <div className="text-center py-6 text-sm text-muted-foreground">Loading...</div>

  return (
    <Card className="p-2">
      {data?.users?.map((u: any) => (
        <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50">
          <Avatar className="w-9 h-9 shrink-0">
            <AvatarFallback>{u.displayName?.charAt(0) || '?'}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{u.displayName} <span className="text-xs text-muted-foreground">@{u.username}</span></div>
            <div className="text-xs text-muted-foreground truncate">{u.email}</div>
          </div>
          <Select
            value={u.role}
            onValueChange={(role) => updateRole.mutate({ userId: u.id, role })}
          >
            <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="member">member</SelectItem>
              <SelectItem value="admin">admin</SelectItem>
              <SelectItem value="owner">owner</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ))}
    </Card>
  )
}

function AdminGroups() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-groups'],
    queryFn: async () => {
      const res = await fetch('/api/admin/groups')
      if (!res.ok) throw new Error('forbidden')
      return res.json()
    },
  })

  const [newChannel, setNewChannel] = useState<{ groupId: string; name: string } | null>(null)

  const createChannel = useMutation({
    mutationFn: async ({ groupId, name }: { groupId: string; name: string }) => {
      const res = await fetch('/api/admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, name }),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-groups'] })
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Channel created')
      setNewChannel(null)
    },
    onError: () => toast.error('Failed'),
  })

  if (isLoading) return <div className="text-center py-6 text-sm text-muted-foreground">Loading...</div>

  return (
    <div className="space-y-3">
      {data?.groups?.map((g: any) => (
        <Card key={g.id} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-semibold text-sm">{g.name}</div>
              <div className="text-xs text-muted-foreground">Owner: {g.owner.displayName}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setNewChannel({ groupId: g.id, name: '' })}>
              <Plus className="w-3 h-3 mr-1" /> Channel
            </Button>
          </div>

          {newChannel?.groupId === g.id && (
            <div className="flex gap-2 mb-3">
              <Input
                placeholder="channel-name"
                value={newChannel.name}
                onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newChannel.name.trim()) createChannel.mutate(newChannel)
                }}
              />
              <Button size="sm" onClick={() => createChannel.mutate(newChannel)} disabled={!newChannel.name.trim()}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => setNewChannel(null)}>Cancel</Button>
            </div>
          )}

          <div className="space-y-0.5">
            {g.channels.map((ch: any) => (
              <div key={ch.id} className="flex items-center gap-2 text-sm p-2 rounded hover:bg-accent/50">
                <Badge variant="outline" className="text-[10px]">{ch.type}</Badge>
                <span className="font-medium">{ch.name}</span>
                <span className="text-xs text-muted-foreground">
                  · {ch._count.members} members · {ch._count.messages} msgs
                </span>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

function AdminBots() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-bots'],
    queryFn: async () => {
      const res = await fetch('/api/admin/bots')
      if (!res.ok) throw new Error('forbidden')
      return res.json()
    },
  })

  const { data: groups } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      return res.json()
    },
  })
  const allChannels = groups?.groups?.flatMap((g: any) =>
    g.channels.map((c: any) => ({ ...c, groupName: g.name }))
  ) || []

  const assignBot = useMutation({
    mutationFn: async ({ botId, channelId }: { botId: string; channelId: string }) => {
      const res = await fetch('/api/admin/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, channelId }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => toast.success('Bot added to channel'),
    onError: () => toast.error('Failed'),
  })

  if (isLoading) return <div className="text-center py-6 text-sm text-muted-foreground">Loading...</div>

  return (
    <Card className="p-2">
      {data?.bots?.map((b: any) => (
        <div key={b.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50">
          <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">
              {b.name} <span className="text-xs text-muted-foreground">@{b.username}</span>
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {b.module} · Owner: {b.owner?.displayName || 'unknown'}
            </div>
          </div>
          <Select
            value=""
            onValueChange={(channelId) => assignBot.mutate({ botId: b.id, channelId })}
          >
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="Add to channel..." />
            </SelectTrigger>
            <SelectContent>
              {allChannels
                .filter((c: any) => c.type === 'text')
                .map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.groupName} / {c.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </Card>
  )
}

// ─── System ───────────────────────────────────────────────────────────────

function SystemSection() {
  const { data, isLoading } = useQuery({
    queryKey: ['ice-servers'],
    queryFn: async () => {
      const res = await fetch('/api/calls/ice-servers')
      return res.json()
    },
  })

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <Server className="w-4 h-4" /> Architecture
        </h3>
        <div className="text-xs text-muted-foreground space-y-2">
          <p>
            <strong>Single-port server:</strong> Next.js + Socket.io share port 3090
            via a custom <code>server.ts</code>. Socket.io is mounted at <code>/api/socket</code>.
          </p>
          <p>
            <strong>Realtime:</strong> In-process Socket.io relay for chat, presence,
            and WebRTC signaling. Auth reads the NextAuth JWT cookie directly.
          </p>
          <p>
            <strong>Database:</strong> SQLite (file-based). Swap <code>DATABASE_URL</code> to
            PostgreSQL for larger groups.
          </p>
          <p>
            <strong>Bot framework:</strong> Each bot is a module in <code>src/lib/bot/bots/</code>.
            Add a file, register, done.
          </p>
          <p>
            <strong>Voice calls:</strong> WebRTC mesh (P2P). SFU-ready for &gt;6 participants.
          </p>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <Hash className="w-4 h-4" /> WebRTC ICE Providers
        </h3>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">STUN:</span>
              <code className="text-xs">{data?.stun}</code>
            </div>
            <div className="border-t pt-2.5 mt-2.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Active TURN providers
              </div>
              <div className="space-y-1.5">
                {data?.providers?.map((p: any) => (
                  <div key={p.name} className="flex items-center justify-between">
                    <span className="font-mono text-xs">{p.name}</span>
                    <div className="flex items-center gap-2">
                      {p.note && <span className="text-xs text-muted-foreground">{p.note}</span>}
                      {p.enabled ? (
                        <Badge className="bg-status-online text-[10px]">ON</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">OFF</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {!data?.providers?.find((p: any) => p.name === 'cloudflare-turn')?.enabled && (
              <div className="mt-3 p-3 bg-muted/50 rounded text-xs">
                <p className="font-medium mb-1">Add Cloudflare TURN (optional, 1 TB free):</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>Cloudflare Dashboard → Realtime / Calls → Create TURN App</li>
                  <li>Copy Key ID and Secret to <code>.env</code></li>
                  <li>Restart server — creds auto-signed per call.</li>
                </ol>
              </div>
            )}
            <div className="mt-2 p-3 bg-primary/5 border border-primary/20 rounded text-xs">
              <p className="font-medium mb-1 text-primary">Metered OpenRelay is on by default</p>
              <p className="text-muted-foreground">
                Free TURN (20 GB/month) — works for most home/mobile networks.
                For heavy use, add Cloudflare TURN (1 TB free) or self-host coturn.
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

/**
 * Avatar picker — shows generated DiceBear avatars + upload option.
 * Users can pick from 56 generated avatars (14 styles × 4 seeds) or upload
 * their own. The gallery is grouped by style with a scrollable container so
 * the long list doesn't dominate the settings panel.
 */
function AvatarPicker({
  currentAvatarUrl,
  userId,
  onPick,
  onUpload,
  uploading,
}: {
  currentAvatarUrl: string
  userId: string
  onPick: (url: string) => void
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  uploading: boolean
}) {
  const [showPicker, setShowPicker] = useState(false)
  const candidates = useMemo(() => generateAvatarCandidates(userId), [userId])

  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center gap-6">
        <Avatar className="w-24 h-24 shadow-2xl ring-4 ring-white/5 hover:ring-primary/50 transition-all cursor-pointer">
          <AvatarImage src={currentAvatarUrl || undefined} />
          <AvatarFallback className="text-3xl font-light">?</AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-3">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Profile Picture</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShowPicker(!showPicker)} className="rounded-xl h-9 px-4 font-medium hover:bg-white/10 transition-colors">
              <Sparkles className="w-4 h-4 mr-2 text-primary" />
              {showPicker ? 'Hide Gallery' : 'Pick Avatar'}
            </Button>
            <label className="cursor-pointer">
              <span className="inline-flex items-center justify-center bg-primary/10 text-primary border border-primary/20 h-9 px-4 rounded-xl text-sm font-medium hover:bg-primary/20 transition-all shadow-glow">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {uploading ? 'Uploading...' : 'Upload Image'}
              </span>
              <input type="file" className="hidden" accept="image/*" onChange={onUpload} disabled={uploading} />
            </label>
          </div>
        </div>
      </div>

      {showPicker && (
        <div className="max-h-96 overflow-y-auto pr-1 -mr-1 space-y-3 pt-2">
          {AVATAR_STYLES.map((style) => {
            const styleCandidates = candidates.filter((c) => c.style === style.key)
            if (styleCandidates.length === 0) return null
            return (
              <div key={style.key} className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
                  {style.label}
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                  {styleCandidates.map((c, i) => (
                    <button
                      key={`${style.key}-${i}`}
                      onClick={() => onPick(c.url)}
                      title={style.label}
                      className={cn(
                        'rounded-xl overflow-hidden border-2 transition-all hover:scale-105 bg-muted/30',
                        currentAvatarUrl === c.url
                          ? 'border-primary ring-2 ring-primary/30'
                          : 'border-transparent'
                      )}
                    >
                      <img src={c.url} alt={`${style.label} avatar`} className="w-full aspect-square" />
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * AddBotToChannel — dropdown to add a bot to any text channel the user is a member of.
 */
function AddBotToChannel({ botId }: { botId: string }) {
  const { data: groups } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      const data = await res.json()
      return data.groups as any[]
    },
  })
  const allTextChannels = groups?.flatMap((g: any) =>
    g.channels.filter((c: any) => c.type === 'text').map((c: any) => ({ ...c, groupName: g.name }))
  ) || []

  const handleAdd = async (channelId: string) => {
    try {
      const res = await fetch('/api/admin/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, channelId }),
      })
      if (res.ok) toast.success('Bot added to channel')
      else toast.error('Failed to add bot')
    } catch {
      toast.error('Failed to add bot')
    }
  }

  if (allTextChannels.length === 0) return null

  return (
    <div className="flex items-center gap-2 pl-12">
      <Select onValueChange={handleAdd}>
        <SelectTrigger className="h-7 text-xs w-48">
          <SelectValue placeholder="+ Add to channel..." />
        </SelectTrigger>
        <SelectContent>
          {allTextChannels.map((ch: any) => (
            <SelectItem key={ch.id} value={ch.id}>
              {ch.groupName} / {ch.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

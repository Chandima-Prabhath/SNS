'use client'

import { useState } from 'react'
import { useBots } from '@/hooks/useBots'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Bot, Plus, Trash2, Terminal, Check, X } from 'lucide-react'
import { toast } from 'sonner'

export function BotsView() {
  const { bots, modules, isLoading, create, update, remove } = useBots()
  const [createOpen, setCreateOpen] = useState(false)

  // New bot form
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [description, setDescription] = useState('')
  const [module, setModule] = useState('echo')

  const handleCreate = async () => {
    try {
      await create({ name, username, description, module })
      toast.success('Bot created! Add it to a channel from the Admin panel.')
      setCreateOpen(false)
      setName('')
      setUsername('')
      setDescription('')
      setModule('echo')
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Bots</h1>
            <p className="text-sm text-muted-foreground">
              Telegram-style bots that respond to commands and mentions.
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" /> Create bot
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create a new bot</DialogTitle>
                <DialogDescription>
                  Bots respond to <code>/commands</code> and <code>@mentions</code> in channels they're a member of.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="bot-name">Bot name</Label>
                  <Input id="bot-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Poll Bot" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bot-username">Username (lowercase, no spaces)</Label>
                  <Input
                    id="bot-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="pollbot"
                    autoCapitalize="none"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bot-desc">Description</Label>
                  <Textarea
                    id="bot-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Runs quick polls in any channel."
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Bot module</Label>
                  <Select value={module} onValueChange={setModule}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modules.map((m) => (
                        <SelectItem key={m.name} value={m.name}>
                          {m.name} — {m.description}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={!name.trim() || !username.trim()}>
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* My bots */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            My Bots ({bots.length})
          </h2>
          {isLoading ? (
            <div className="text-center text-sm text-muted-foreground py-8">Loading...</div>
          ) : bots.length === 0 ? (
            <Card className="p-8 text-center">
              <Bot className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                No bots yet. Create one to automate tasks in your channels.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {bots.map((bot) => (
                <BotCard key={bot.id} bot={bot} modules={modules} onUpdate={update} onDelete={remove} />
              ))}
            </div>
          )}
        </div>

        {/* Available modules */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
            Available Bot Modules ({modules.length})
          </h2>
          <div className="space-y-3">
            {modules.map((m) => (
              <div key={m.name} className="border rounded-lg p-3">
                <div className="flex items-baseline gap-2 mb-1">
                  <code className="text-sm font-mono font-medium">{m.name}</code>
                  <span className="text-xs text-muted-foreground">{m.description}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {m.commands.map((c: any) => (
                    <Badge key={c.name} variant="secondary" className="font-mono text-xs">
                      /{c.name}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 text-xs text-muted-foreground bg-muted/50 rounded p-3 flex gap-2">
            <Terminal className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium mb-1">Want to add your own bot?</p>
              <p>
                Drop a new file in <code>src/lib/bot/bots/</code>, export a{' '}
                <code>BotModule</code>, and register it in{' '}
                <code>src/lib/bot/index.ts</code>. The framework auto-discovers
                commands — no core changes needed.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function BotCard({
  bot,
  modules,
  onUpdate,
  onDelete,
}: {
  bot: any
  modules: any[]
  onUpdate: (params: { id: string; data: any }) => Promise<any>
  onDelete: (id: string) => Promise<any>
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(bot.name)
  const [description, setDescription] = useState(bot.description || '')
  const [module, setModule] = useState(bot.module)
  const [privacyMode, setPrivacyMode] = useState(bot.privacyMode)

  const mod = modules.find((m) => m.name === bot.module)

  const handleSave = async () => {
    try {
      await onUpdate({ id: bot.id, data: { name, description, module, privacyMode } })
      toast.success('Bot updated')
      setEditing(false)
    } catch {
      toast.error('Failed to update')
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete bot @${bot.username}? This cannot be undone.`)) return
    try {
      await onDelete(bot.id)
      toast.success('Bot deleted')
    } catch {
      toast.error('Failed to delete')
    }
  }

  return (
    <Card className="p-4">
      {editing ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10">
              <AvatarFallback><Bot className="w-5 h-5" /></AvatarFallback>
            </Avatar>
            <code className="text-sm">@{bot.username}</code>
          </div>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-2">
            <Label>Module</Label>
            <Select value={module} onValueChange={setModule}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {modules.map((m) => (
                  <SelectItem key={m.name} value={m.name}>
                    {m.name} — {m.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="privacy">Privacy mode (only respond to commands/mentions)</Label>
            <Switch id="privacy" checked={privacyMode} onCheckedChange={setPrivacyMode} />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave}><Check className="w-4 h-4 mr-1" /> Save</Button>
            <Button variant="outline" onClick={() => setEditing(false)}><X className="w-4 h-4 mr-1" /> Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <Avatar className="w-10 h-10">
            <AvatarFallback><Bot className="w-5 h-5" /></AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{bot.name}</span>
              <code className="text-xs text-muted-foreground">@{bot.username}</code>
              <Badge variant={bot.enabled ? 'default' : 'secondary'}>
                {bot.enabled ? 'enabled' : 'disabled'}
              </Badge>
              <Badge variant="outline">{bot.module}</Badge>
              {bot.privacyMode && <Badge variant="outline">privacy</Badge>}
            </div>
            {bot.description && (
              <p className="text-sm text-muted-foreground mt-1">{bot.description}</p>
            )}
            {mod && (
              <div className="flex flex-wrap gap-1 mt-2">
                {mod.commands.map((c: any) => (
                  <Badge key={c.name} variant="secondary" className="font-mono text-xs">
                    /{c.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onUpdate({ id: bot.id, data: { enabled: !bot.enabled } })}
            >
              {bot.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleDelete} className="text-red-500">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
